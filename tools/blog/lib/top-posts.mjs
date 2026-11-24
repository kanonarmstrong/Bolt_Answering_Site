/* "Top 5" (AFMBP-2691, owner 11-23): the blog's right column lists the five most-read posts,
   ranked by all-time readers in Google Analytics (the GA4 property the site's tag reports to).
   The owner picked Google over WordPress.com's own view counts: one analytics source, fewer
   pipelines to manage.

   - "Readers" = GA4 active users per post page (/blog/<slug>/), all time. People, not page
     loads, so one visitor reloading a post can't push it up the list.
   - The Blog workflow refreshes the ranking once a day (and on "Run workflow") with a read-only
     Google service-account key kept in GitHub's secret store (GA4_SA_KEY). Every other build
     reuses the saved order.
   - Only the ORDER is saved: post slugs in blog/.top-posts.json. The site repo is public, so
     reader counts never reach a file, a commit or a log.
   - With no saved order (no key yet), or when nobody has read any post, the column stays
     "Recent posts". It never says "Top 5" over a list that isn't ranked.
   - Ties go to the newer post. When fewer than five posts have readers, the newest of the
     rest fill the list (they are tied at none). */
import { createSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const TOP_POSTS_FILE = 'blog/.top-posts.json';
export const TOP_COUNT = 5;
/** Slugs kept in the saved order: enough to refill the five if a couple of posts are unpublished. */
export const KEEP = 10;
/** The GA4 property behind the site tag G-8C8SFMCRYH (an id, not a secret). */
export const GA4_PROPERTY = '555328343';
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** The service-account key (the JSON file from Google Cloud). Errors never repeat its contents. */
export function parseKey(json) {
  let key = null;
  try { key = JSON.parse(json); } catch {}
  if (!key || typeof key.client_email !== 'string' || typeof key.private_key !== 'string' || !key.private_key.includes('PRIVATE KEY')) {
    throw new Error('GA4_SA_KEY is not a Google service-account key (the JSON file from Google Cloud)');
  }
  return key;
}

const b64url = (data) => Buffer.from(data).toString('base64url');

/** A signed request for a one-hour, read-only Google Analytics token (JWT bearer, RS256). */
export function serviceAccountJwt(key, now = Math.floor(Date.now() / 1000)) {
  const header = { alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) };
  const claims = { iss: key.client_email, scope: GA4_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${unsigned}.${b64url(createSign('RSA-SHA256').update(unsigned).sign(key.private_key))}`;
}

async function googleToken({ key, fetchImpl }) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountJwt(key) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body?.access_token !== 'string') {
    throw new Error(`Google sign-in failed: HTTP ${res.status}${/^[a-z_]{1,40}$/.test(body?.error || '') ? ` ${body.error}` : ''}`);
  }
  return body.access_token;
}

/** The GA4 report: active users per page path under /blog/, all time. */
export function reportRequest() {
  return {
    dateRanges: [{ startDate: '2020-01-01', endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'activeUsers' }],
    dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/blog/' } } },
    limit: 10000,
  };
}

/** /blog/<slug>/ (also without the slash, or ending index.html) → slug. The blog home, list
 *  pages, categories and search → null. */
export function slugFromPath(path) {
  const m = /^\/blog\/([^/?#]+)(?:\/(?:index\.html)?)?$/.exec(typeof path === 'string' ? path : '');
  return m && m[1] !== 'search' ? m[1] : null;
}

/** Readers per post slug from a GA4 runReport answer. Anything unexpected throws, so a changed
 *  API can't silently empty the ranking. GA4 leaves `rows` out when there are none. */
export function readersBySlug(data) {
  if (!data || !Array.isArray(data.metricHeaders)) {
    throw new Error(`unexpected Google Analytics response (keys: ${Object.keys(data || {}).sort().join(', ') || 'none'})`);
  }
  const rows = data.rows ?? [];
  if (!Array.isArray(rows)) throw new Error('unexpected Google Analytics response (rows)');
  const readers = new Map();
  let valid = 0;
  for (const r of rows) {
    const path = r?.dimensionValues?.[0]?.value;
    const n = Number(r?.metricValues?.[0]?.value);
    if (typeof path !== 'string' || !Number.isFinite(n) || n < 0) continue;
    valid++;
    const slug = slugFromPath(path);
    if (slug) readers.set(slug, (readers.get(slug) || 0) + n);
  }
  if (rows.length && !valid) throw new Error('unexpected Google Analytics response (no path/readers pairs)');
  return readers;
}

/** Sign in with the key, then run the report. Errors carry HTTP statuses and Google's error
 *  codes only: never the key, the token or the counts. */
export async function fetchReaders({ key, property = GA4_PROPERTY, fetchImpl = fetch }) {
  const token = await googleToken({ key, fetchImpl });
  const res = await fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(reportRequest()),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google Analytics answered HTTP ${res.status}${/^[A-Z_]{1,40}$/.test(body?.error?.status || '') ? ` ${body.error.status}` : ''}`);
  }
  return readersBySlug(body);
}

/** Post slugs, most-read first; ties go to the newer post. Posts nobody has read are left out. */
export function rankPosts(posts, readers) {
  return posts
    .filter((p) => (readers.get(p.slug) || 0) > 0)
    .sort((a, b) => readers.get(b.slug) - readers.get(a.slug) || b.datePublished.localeCompare(a.datePublished))
    .map((p) => p.slug);
}

/** The saved order, or null when there is none or it can't be read. */
export function readSavedOrder(repoRoot) {
  const file = join(repoRoot, TOP_POSTS_FILE);
  if (!existsSync(file)) return null;
  try {
    const { order } = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(order) && order.every((s) => typeof s === 'string' && s && !s.includes('/')) ? order : null;
  } catch {
    return null;
  }
}

/** Save the order (slugs only). Written outside the build manifest, so a build that doesn't
 *  refresh never deletes it. */
export function writeSavedOrder(repoRoot, order) {
  const file = join(repoRoot, TOP_POSTS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({
    about: 'Blog "Top 5" order (AFMBP-2691): post slugs, most-read first by all-time Google Analytics readers. Written by tools/blog/build.mjs. Holds no reader counts.',
    order,
  }, null, 2)}\n`);
}

/** Refresh the saved order from Google Analytics. Throws on any failure, leaving the last
 *  saved order in place. */
export async function refreshOrder({ repoRoot, posts, key, property, fetchImpl }) {
  const readers = await fetchReaders({ key, property, fetchImpl });
  writeSavedOrder(repoRoot, rankPosts(posts, readers).slice(0, KEEP));
}

/** The five posts for the column, or null for "Recent posts". */
export function topFive(posts, order) {
  if (!order?.length) return null;
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  const ranked = [...new Set(order)].map((s) => bySlug.get(s)).filter(Boolean);
  if (!ranked.length) return null;
  const rest = posts.filter((p) => !ranked.includes(p)).sort((a, b) => b.datePublished.localeCompare(a.datePublished));
  return [...ranked, ...rest].slice(0, TOP_COUNT);
}
