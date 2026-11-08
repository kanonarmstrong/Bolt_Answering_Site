#!/usr/bin/env node
/* Turns markdown drafts into a WordPress import file (WXR), so they arrive in WordPress
   as DRAFTS for review. Optionally also writes REST-shaped fixtures for a local preview.

   Usage:
     node tools/blog/make-wxr.mjs --out drafts.xml [--fixtures-out dir] [--category "Name"] post1.md post2.md …

   Each markdown file may start with front matter:
     ---
     title_tag: …            -> "Search title" field (bolt_seo_title)
     meta_description: …     -> "Search description" field (bolt_seo_description) and excerpt
     slug: /blog/my-post     -> post slug
     category: How Bolt Works  (optional; overrides --category)
     ---
   The first "# Heading" becomes the post title and is removed from the body.
   Front-matter lines starting with "STATUS:" mean "do not import" and the file is skipped. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { marked } from 'marked';
import { slugify } from './lib/util.mjs';

export function parseDraft(md, file = '') {
  let front = {};
  let body = md;
  const fm = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    body = md.slice(fm[0].length);
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
      if (m) front[m[1].toLowerCase()] = m[2].trim();
    }
  }
  if (front.status) return { skip: true, reason: front.status, file };
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = h1 ? h1[1].trim() : basename(file, '.md');
  if (h1) body = body.replace(h1[0], '');
  const slug = (front.slug || '').replace(/^\/?blog\//, '').replace(/^\/+|\/+$/g, '') || slugify(title);
  return {
    title,
    slug,
    seoTitle: front.title_tag || '',
    description: front.meta_description || '',
    category: front.category || '',
    html: marked.parse(body.trim(), { mangle: false, headerIds: false }),
  };
}

const cdata = (s) => `<![CDATA[${String(s).replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

export function toWxr(posts, { category = 'Blog' } = {}) {
  const cats = [...new Set(posts.map((p) => p.category || category))];
  const items = posts.map((p, i) => {
    const cat = p.category || category;
    return `  <item>
    <title>${cdata(p.title)}</title>
    <dc:creator>${cdata('admin')}</dc:creator>
    <content:encoded>${cdata(p.html)}</content:encoded>
    <excerpt:encoded>${cdata(p.description)}</excerpt:encoded>
    <wp:post_id>${9000 + i}</wp:post_id>
    <wp:post_name>${cdata(p.slug)}</wp:post_name>
    <wp:status>${cdata('draft')}</wp:status>
    <wp:post_type>${cdata('post')}</wp:post_type>
    <wp:comment_status>${cdata('closed')}</wp:comment_status>
    <wp:ping_status>${cdata('closed')}</wp:ping_status>
    <category domain="category" nicename="${slugify(cat)}">${cdata(cat)}</category>
    <wp:postmeta><wp:meta_key>${cdata('bolt_seo_title')}</wp:meta_key><wp:meta_value>${cdata(p.seoTitle)}</wp:meta_value></wp:postmeta>
    <wp:postmeta><wp:meta_key>${cdata('bolt_seo_description')}</wp:meta_key><wp:meta_value>${cdata(p.description)}</wp:meta_value></wp:postmeta>
  </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
  <title>Bolt blog drafts</title>
  <link>https://www.boltanswering.com/blog/</link>
  <language>en-US</language>
  <wp:wxr_version>1.2</wp:wxr_version>
${cats.map((c, i) => `  <wp:category><wp:term_id>${100 + i}</wp:term_id><wp:category_nicename>${cdata(slugify(c))}</wp:category_nicename><wp:category_parent>${cdata('')}</wp:category_parent><wp:cat_name>${cdata(c)}</wp:cat_name></wp:category>`).join('\n')}
${items.join('\n')}
</channel>
</rss>
`;
}

/* REST-API-shaped fixtures (status forced to publish) for previewing drafts locally. */
export function toFixtures(posts, { category = 'Blog' } = {}) {
  const cats = [...new Set(posts.map((p) => p.category || category))].map((name, i) => ({ id: 10 + i, name, slug: slugify(name), description: '' }));
  const catId = (name) => cats.find((c) => c.name === name).id;
  const day = 24 * 3600 * 1000;
  const start = Date.UTC(2026, 9, 15, 16);
  return {
    categories: cats,
    posts: posts.map((p, i) => {
      const d = new Date(start + i * 7 * day).toISOString().slice(0, 19);
      return {
        id: 500 + i, status: 'publish', slug: p.slug, date: d, date_gmt: d, modified: d, modified_gmt: d,
        link: `https://cms.example.test/${p.slug}/`,
        title: { rendered: p.title }, excerpt: { rendered: `<p>${p.description}</p>` }, content: { rendered: p.html },
        categories: [catId(p.category || category)], meta: { bolt_seo_title: p.seoTitle, bolt_seo_description: p.description },
        _embedded: { author: [{ name: 'Kanon Armstrong', slug: 'kanon', description: '' }] },
      };
    }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i > -1 ? args.splice(i, 2)[1] : undefined; };
  const out = opt('--out');
  const fixturesOut = opt('--fixtures-out');
  const category = opt('--category') || 'Blog';
  if (!out || !args.length) { console.error('Usage: make-wxr.mjs --out drafts.xml [--fixtures-out dir] [--category Name] files…'); process.exit(2); }
  const parsed = args.map((f) => parseDraft(readFileSync(f, 'utf8'), f));
  for (const s of parsed.filter((p) => p.skip)) console.log(`Skipped ${s.file}: ${s.reason}`);
  const posts = parsed.filter((p) => !p.skip);
  writeFileSync(out, toWxr(posts, { category }));
  console.log(`Wrote ${out} with ${posts.length} draft(s): ${posts.map((p) => p.slug).join(', ')}`);
  if (fixturesOut) {
    mkdirSync(fixturesOut, { recursive: true });
    const f = toFixtures(posts, { category });
    writeFileSync(join(fixturesOut, 'posts.json'), JSON.stringify(f.posts, null, 2));
    writeFileSync(join(fixturesOut, 'categories.json'), JSON.stringify(f.categories, null, 2));
    writeFileSync(join(fixturesOut, 'site.json'), JSON.stringify({ host: 'cms.example.test' }));
    console.log(`Wrote preview fixtures to ${fixturesOut}`);
  }
}
