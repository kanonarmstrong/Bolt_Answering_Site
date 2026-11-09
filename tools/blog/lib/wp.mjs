/* Reads published posts from WordPress's REST API (or from fixture files for tests and
   local previews) and normalizes them into the shape the templates use. Only PUBLISHED
   posts are read; drafts never reach the site. No credentials are needed or used. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeEntities, stripTags, truncate, slugify } from './util.mjs';

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'bolt-blog-build' } });
  if (!res.ok) throw new Error(`WordPress request failed: ${res.status} ${url}`);
  return { data: await res.json(), totalPages: Number(res.headers.get('x-wp-totalpages') || 1) };
}

async function getAll(apiBase, route, params) {
  const out = [];
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ per_page: '100', page: String(page), ...params });
    const { data, totalPages } = await getJson(`${apiBase}/${route}?${qs}`);
    out.push(...data);
    if (page >= totalPages) break;
  }
  return out;
}

/**
 * Turn the REST API address a WordPress site advertises (its Link: rel="https://api.w.org/"
 * header) into the base for /wp/v2 routes. Self-hosted and WordPress.com Business sites
 * advertise https://site/wp-json/; WordPress.com Personal/Premium ("simple") sites
 * advertise https://public-api.wordpress.com/wp-json/?rest_route=/sites/<site>, whose
 * /wp/v2 routes live at https://public-api.wordpress.com/wp/v2/sites/<site>.
 */
export function apiBaseFromLink(link) {
  const u = new URL(link);
  const route = u.searchParams.get('rest_route');
  if (u.host === 'public-api.wordpress.com' && route && /^\/sites\/[^/]+\/?$/.test(route)) {
    return `https://public-api.wordpress.com/wp/v2${route.replace(/\/+$/, '')}`;
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}/wp/v2`;
}

/** Ask the site where its REST API lives. WP_API_BASE, if set, skips the lookup. */
export async function discoverApiBase(baseUrl) {
  if (process.env.WP_API_BASE) return process.env.WP_API_BASE.replace(/\/+$/, '');
  const res = await fetch(baseUrl, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': 'bolt-blog-build' } });
  const header = res.headers.get('link') || '';
  const m = header.match(/<([^>]+)>;\s*rel="https:\/\/api\.w\.org\/"/);
  return m ? apiBaseFromLink(m[1]) : `${baseUrl}/wp-json/wp/v2`;
}

/** Fetch raw posts and categories from a live WordPress site. */
export async function fetchFromWordPress(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  const apiBase = await discoverApiBase(base);
  const [posts, categories] = await Promise.all([
    getAll(apiBase, 'posts', { status: 'publish', _embed: '1', orderby: 'date', order: 'desc' }),
    getAll(apiBase, 'categories', { hide_empty: 'true' }),
  ]);
  return { posts, categories, wpHost: new URL(base).host, apiBase };
}

/** Load the same shapes from fixture files (posts.json, categories.json). */
export function loadFixtures(dir) {
  const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return { posts: read('posts.json'), categories: read('categories.json'), wpHost: read('site.json').host, fixtureDir: dir };
}

/** Normalize raw WordPress JSON into the build's post model. */
export function normalize({ posts, categories }) {
  const catById = new Map(
    categories
      .filter((c) => c.slug !== 'uncategorized')
      .map((c) => [c.id, { id: c.id, name: decodeEntities(c.name), slug: c.slug || slugify(c.name), description: stripTags(c.description || '') }]),
  );
  const out = posts
    .filter((p) => p.status === 'publish' || p.status === undefined)
    .map((p) => {
      const emb = p._embedded || {};
      const media = (emb['wp:featuredmedia'] || [])[0];
      const author = (emb.author || [])[0];
      const tags = ((emb['wp:term'] || []).flat() || []).filter((t) => t.taxonomy === 'post_tag').map((t) => ({ name: decodeEntities(t.name), slug: t.slug }));
      const title = decodeEntities(stripTags(p.title?.rendered || ''));
      const excerptText = stripTags(p.excerpt?.rendered || '');
      const meta = p.meta || {};
      return {
        id: p.id,
        slug: p.slug,
        title,
        // Search fields: the Bolt plugin's, else WordPress.com's built-in SEO fields, else title/excerpt.
        seoTitle: (meta.bolt_seo_title || meta.jetpack_seo_html_title || '').trim() || title,
        description: truncate((meta.bolt_seo_description || meta.advanced_seo_description || '').trim() || excerptText || stripTags(p.content?.rendered || ''), 158),
        excerpt: truncate(excerptText || stripTags(p.content?.rendered || ''), 220),
        contentHtml: p.content?.rendered || '',
        datePublished: new Date(p.date_gmt ? `${p.date_gmt}Z` : p.date).toISOString(),
        dateModified: new Date(p.modified_gmt ? `${p.modified_gmt}Z` : p.modified || p.date).toISOString(),
        categories: (p.categories || []).map((id) => catById.get(id)).filter(Boolean),
        tags,
        author: { name: author?.name || 'Bolt Team', description: stripTags(author?.description || ''), slug: author?.slug || 'bolt', avatar: author?.avatar_urls?.['96'] || null },
        image: media && media.source_url
          ? { src: media.source_url, alt: (media.alt_text || '').trim(), width: media.media_details?.width, height: media.media_details?.height }
          : null,
        wpLink: p.link || '',
      };
    })
    .sort((a, b) => b.datePublished.localeCompare(a.datePublished));
  const usedCats = new Map();
  for (const p of out) for (const c of p.categories) usedCats.set(c.slug, c);
  return { posts: out, categories: [...usedCats.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
