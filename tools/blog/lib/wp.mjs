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

async function getAll(base, route, params) {
  const out = [];
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ per_page: '100', page: String(page), ...params });
    const { data, totalPages } = await getJson(`${base}/wp-json/wp/v2/${route}?${qs}`);
    out.push(...data);
    if (page >= totalPages) break;
  }
  return out;
}

/** Fetch raw posts and categories from a live WordPress site. */
export async function fetchFromWordPress(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  const [posts, categories] = await Promise.all([
    getAll(base, 'posts', { status: 'publish', _embed: '1', orderby: 'date', order: 'desc' }),
    getAll(base, 'categories', { hide_empty: 'true' }),
  ]);
  return { posts, categories, wpHost: new URL(base).host };
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
        seoTitle: (meta.bolt_seo_title || '').trim() || title,
        description: truncate((meta.bolt_seo_description || '').trim() || excerptText || stripTags(p.content?.rendered || ''), 158),
        excerpt: truncate(excerptText || stripTags(p.content?.rendered || ''), 220),
        contentHtml: p.content?.rendered || '',
        datePublished: new Date(p.date_gmt ? `${p.date_gmt}Z` : p.date).toISOString(),
        dateModified: new Date(p.modified_gmt ? `${p.modified_gmt}Z` : p.modified || p.date).toISOString(),
        categories: (p.categories || []).map((id) => catById.get(id)).filter(Boolean),
        tags,
        author: { name: author?.name || 'Bolt Team', description: stripTags(author?.description || ''), slug: author?.slug || 'bolt' },
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
