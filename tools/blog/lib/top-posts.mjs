/* "Top 5" (AFMBP-2691, owner 11-23): the blog's right column lists the five most-read posts,
   ranked by all-time views in WordPress.com Stats.

   - The Blog workflow refreshes the ranking once a day (and on "Run workflow") with a
     WordPress.com token kept in GitHub's secret store (WP_STATS_TOKEN). Every other build
     reuses the saved order.
   - Only the ORDER is saved: WordPress post ids in blog/.top-posts.json. The site repo is
     public, so view counts never reach a file, a commit or a log.
   - With no saved order (no token yet), or when nobody has read any post, the column stays
     "Recent posts". It never says "Top 5" over a list that isn't ranked.
   - Ties go to the newer post. When fewer than five posts have been read, the newest of the
     rest fill the list (they are tied at no views). */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const TOP_POSTS_FILE = 'blog/.top-posts.json';
export const TOP_COUNT = 5;
/** Ids kept in the saved order: enough to refill the five if a couple of posts are unpublished. */
export const KEEP = 10;

/** WordPress.com REST v1.1 top posts, summed over the last 10 years: all-time views for this blog. */
export function statsUrl(site) {
  const qs = new URLSearchParams({ period: 'year', num: '10', max: '100', summarize: 'true', skip_archives: 'true' });
  return `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(site)}/stats/top-posts?${qs}`;
}

/** Views per WordPress post id from a top-posts response: the summary (summarize=true) or the
 *  per-period days. Anything else throws, so a changed API can't silently empty the ranking. */
export function viewsById(data) {
  const fromList = (x) => (Array.isArray(x) ? x.flatMap((e) => (Array.isArray(e?.postviews) ? e.postviews : [e])) : null);
  let items = null;
  if (Array.isArray(data?.summary?.postviews)) items = data.summary.postviews;
  else if (Array.isArray(data?.summary)) items = fromList(data.summary);
  else if (data?.days && typeof data.days === 'object') items = Object.values(data.days).flatMap((d) => (Array.isArray(d?.postviews) ? d.postviews : []));
  if (!items) throw new Error(`unexpected WordPress Stats response (keys: ${Object.keys(data || {}).sort().join(', ') || 'none'})`);
  const views = new Map();
  let valid = 0;
  for (const item of items) {
    const id = Number(item?.id);
    const n = Number(item?.views);
    if (!Number.isInteger(id) || !Number.isFinite(n) || n < 0) continue;
    valid++;
    if (id > 0) views.set(id, (views.get(id) || 0) + n); // id 0 = home page / archives
  }
  if (items.length && !valid) throw new Error('unexpected WordPress Stats response (no id/views pairs)');
  return views;
}

/** Ask WordPress.com Stats for all-time views. The token goes only in the Authorization header,
 *  and errors carry the HTTP status and WordPress's error code, never the token or the counts. */
export async function fetchViews({ site, token, fetchImpl = fetch }) {
  const res = await fetchImpl(statsUrl(site), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'bolt-blog-build' },
  });
  if (!res.ok) {
    let code = '';
    try { const body = await res.json(); if (/^[a-z_]{1,40}$/.test(body?.error || '')) code = ` ${body.error}`; } catch {}
    throw new Error(`WordPress Stats answered HTTP ${res.status}${code}`);
  }
  return viewsById(await res.json());
}

/** Post ids, most-read first; ties go to the newer post. Posts nobody has read are left out. */
export function rankPosts(posts, views) {
  return posts
    .filter((p) => (views.get(p.id) || 0) > 0)
    .sort((a, b) => views.get(b.id) - views.get(a.id) || b.datePublished.localeCompare(a.datePublished))
    .map((p) => p.id);
}

/** The saved order, or null when there is none or it can't be read. */
export function readSavedOrder(repoRoot) {
  const file = join(repoRoot, TOP_POSTS_FILE);
  if (!existsSync(file)) return null;
  try {
    const { order } = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(order) && order.every((id) => Number.isInteger(id) && id > 0) ? order : null;
  } catch {
    return null;
  }
}

/** Save the order (ids only). Written outside the build manifest, so a build that doesn't
 *  refresh never deletes it. */
export function writeSavedOrder(repoRoot, order) {
  const file = join(repoRoot, TOP_POSTS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({
    about: 'Blog "Top 5" order (AFMBP-2691): WordPress post ids, most-read first by all-time WordPress.com Stats views. Written by tools/blog/build.mjs. Holds no view counts.',
    order,
  }, null, 2)}\n`);
}

/** Refresh the saved order from WordPress.com Stats. Returns nothing; throws on any failure,
 *  leaving the last saved order in place. */
export async function refreshOrder({ repoRoot, posts, site, token, fetchImpl }) {
  const views = await fetchViews({ site, token, fetchImpl });
  writeSavedOrder(repoRoot, rankPosts(posts, views).slice(0, KEEP));
}

/** The five posts for the column, or null for "Recent posts". */
export function topFive(posts, order) {
  if (!order?.length) return null;
  const byId = new Map(posts.map((p) => [p.id, p]));
  const ranked = [...new Set(order)].map((id) => byId.get(id)).filter(Boolean);
  if (!ranked.length) return null;
  const rest = posts.filter((p) => !ranked.includes(p)).sort((a, b) => b.datePublished.localeCompare(a.datePublished));
  return [...ranked, ...rest].slice(0, TOP_COUNT);
}
