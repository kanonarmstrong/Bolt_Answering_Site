#!/usr/bin/env node
/* Builds boltanswering.com/blog from WordPress.

   Usage:
     WP_BASE_URL=https://cms.boltanswering.com node tools/blog/build.mjs
     node tools/blog/build.mjs --fixtures tools/blog/fixtures/wp     (offline sample posts)

   Writes, relative to the repo root:
     blog/index.html, blog/page/N/, blog/<slug>/, blog/category/<slug>/, blog/search/,
     blog/img/<slug>/*, blog/feed.xml, blog/search-index.json, blog/.manifest.json,
     sitemap.xml, robots.txt, llms.txt

   Anything it generated last time but not this time (an unpublished or deleted post)
   is removed, using blog/.manifest.json. Hand-made files are never touched.

   "Top 5" (lib/top-posts.mjs): with TOP_POSTS_REFRESH=1 and GA4_SA_KEY set, it first
   refreshes blog/.top-posts.json from Google Analytics; otherwise it reuses that file. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFromWordPress, loadFixtures, normalize } from './lib/wp.mjs';
import { processContent, processImage, processAvatar } from './lib/content.mjs';
import { layout as renderLayout, listPage, articlePage, searchPage } from './lib/templates.mjs';
import { readSiteChrome } from './lib/chrome.mjs';
import { articleJsonLd, breadcrumbJsonLd, faqJsonLd, blogJsonLd, staticPages, sitemapXml, rssXml, robotsTxt, llmsTxt, readSoloPricing } from './lib/seo.mjs';
import { abs, postPath, categoryPath, pagePath, stripTags, readingMinutes, BLOG_PATH, POSTS_PER_PAGE } from './lib/util.mjs';
import { parseKey, readSavedOrder, refreshOrder, topFive } from './lib/top-posts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Hide every part of the Google key (and the key itself) in a message meant for a public log. */
function redactKey(message, keyJson) {
  const parts = [keyJson];
  try { const k = JSON.parse(keyJson); parts.push(k.private_key, k.client_email, k.private_key_id, k.client_id); } catch {}
  return parts.filter((p) => typeof p === 'string' && p.length >= 8).reduce((m, p) => m.split(p).join('[redacted]'), message);
}

/** topPosts: { refresh, gaKey, property, fetchImpl } — refresh the "Top 5" order from Google
 *  Analytics before building (the Blog workflow asks once a day). gaKey = the service-account
 *  key JSON; property defaults to the site's GA4 property. */
export async function build({ repoRoot = resolve(HERE, '..', '..'), wpBaseUrl, fixturesDir, log = console.log, topPosts = {} } = {}) {
  const raw = fixturesDir ? loadFixtures(resolve(fixturesDir)) : await fetchFromWordPress(wpBaseUrl);
  const { posts, categories } = normalize(raw);
  const ctx = { repoRoot, wpHost: raw.wpHost, fixtureDir: raw.fixtureDir, linkMap: new Map() };
  for (const p of posts) {
    if (p.wpLink) { try { ctx.linkMap.set(new URL(p.wpLink).pathname.replace(/\/+$/, '/'), p.slug); } catch {} }
    ctx.linkMap.set(`?p=${p.id}`, p.slug);
  }

  const warnings = [];
  const written = new Set();
  const keepImages = new Map();
  const avatarCache = new Map();
  const write = (rel, content) => {
    const full = join(repoRoot, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
    written.add(rel);
  };

  // Content + images first: templates need the processed HTML and image sizes.
  for (const p of posts) {
    const res = await processContent(p, ctx);
    p.html = res.html;
    p.faq = res.faq;
    warnings.push(...res.warnings);
    keepImages.set(p.slug, new Set(res.keepFiles));
    if (p.image) {
      try {
        const alt = p.image.alt;
        const img = await processImage(p.image.src, { slug: p.slug, ...ctx });
        p.image = { ...img, alt: alt || p.title };
        img.files.forEach((f) => keepImages.get(p.slug).add(f));
        if (!alt) warnings.push(`"${p.title}": featured image has no alt text. Add it in the WordPress Media Library.`);
      } catch (e) {
        warnings.push(`"${p.title}": featured image skipped (${e.message})`);
        p.image = null;
      }
    } else {
      warnings.push(`"${p.title}": no featured image. Posts look and share better with one.`);
    }
    if (p.author.avatar) {
      try {
        const av = await processAvatar(p.author.avatar, { slug: p.slug, ...ctx }, avatarCache);
        p.author.avatar = av ? av.src : null;
        if (av) keepImages.get(p.slug).add(av.file);
      } catch (e) {
        warnings.push(`"${p.title}": author photo skipped (${e.message})`);
        p.author.avatar = null;
      }
    }
    const text = stripTags(p.html);
    p.wordCount = text.split(/\s+/).filter(Boolean).length;
    p.minutes = readingMinutes(text);
  }

  for (const c of categories) c.count = posts.filter((p) => p.categories.some((pc) => pc.slug === c.slug)).length;
  const recent = posts.slice(0, 5);
  // The right column: "Top 5" once Google Analytics has ranked the posts, else "Recent posts"
  // (a post's own page then leaves itself out). The Top 5 is the same on every page, the post
  // being read included (owner 11-23). Counts are never logged: the repo and its logs are public.
  let topPostsError = null;
  if (topPosts.refresh) {
    if (!topPosts.gaKey) {
      log('Top 5: GA4_SA_KEY is not set, so the order was not refreshed.');
    } else {
      try {
        await refreshOrder({ repoRoot, posts, key: parseKey(topPosts.gaKey), property: topPosts.property, fetchImpl: topPosts.fetchImpl });
        log('Top 5: order refreshed from Google Analytics.');
      } catch (e) {
        topPostsError = redactKey(String(e?.message || e), topPosts.gaKey);
        log(`WARNING Top 5: refresh failed (${topPostsError}); kept the last saved order.`);
      }
    }
  }
  const top = topFive(posts, readSavedOrder(repoRoot));
  const side = (p) => (top
    ? { heading: 'Top 5', items: top }
    : { heading: 'Recent posts', items: p ? recent.filter((r) => r.slug !== p.slug).slice(0, 4) : recent });
  // Every blog page wears the marketing site's own header and footer; Benchy only styles the content.
  const site = readSiteChrome(repoRoot);
  const layout = (opts) => renderLayout({ ...opts, chrome: site });
  const chrome = (body) => body;
  const home = { name: 'Home', href: '/' };
  const blogCrumb = { name: 'Blog', href: BLOG_PATH };

  // With nothing published yet, ship only the site-wide crawler files (no empty blog pages).
  const hasPosts = posts.length > 0;

  // Blog home + pagination.
  const pages = Math.max(1, Math.ceil(posts.length / POSTS_PER_PAGE));
  const listPaths = [];
  for (let n = 1; hasPosts && n <= pages; n++) {
    const slice = posts.slice((n - 1) * POSTS_PER_PAGE, n * POSTS_PER_PAGE);
    const path = pagePath(n);
    listPaths.push(path);
    const crumbs = n === 1 ? [home, { name: 'Blog' }] : [home, blogCrumb, { name: `Page ${n}` }];
    write(`${path.slice(1)}index.html`, layout({
      title: n === 1 ? 'Bolt Answering blog: practical advice for independent trades pros' : `Bolt Answering blog, page ${n}`,
      description: 'Practical, sourced advice for independent HVAC, plumbing, and electrical pros on missed calls, booking, pricing, and growing a trades business.',
      canonical: abs(path),
      prev: n > 1 ? abs(pagePath(n - 1)) : undefined,
      next: n < pages ? abs(pagePath(n + 1)) : undefined,
      jsonLd: [blogJsonLd(posts), breadcrumbJsonLd(crumbs)],
      body: chrome(listPage({ crumbs: n === 1 ? undefined : crumbs, posts: slice, current: n, total: pages, side: side(), categories })),
    }));
  }

  // Category pages (one page each; paginate later if a category passes ~50 posts).
  for (const c of categories) {
    const inCat = posts.filter((p) => p.categories.some((pc) => pc.slug === c.slug));
    const crumbs = [home, blogCrumb, { name: c.name }];
    write(`${categoryPath(c.slug).slice(1)}index.html`, layout({
      title: `${c.name} | Bolt Answering blog`,
      description: c.description || `Bolt Answering blog posts about ${c.name.toLowerCase()} for independent trades pros.`,
      canonical: abs(categoryPath(c.slug)),
      jsonLd: [breadcrumbJsonLd(crumbs)],
      body: chrome(listPage({ heading: c.name, posts: inCat, current: 1, total: 1, side: side(), categories, intro: c.description })),
    }));
  }

  // Articles.
  for (const p of posts) {
    const cat = p.categories[0];
    const crumbs = [home, blogCrumb, ...(cat ? [{ name: cat.name, href: categoryPath(cat.slug) }] : []), { name: p.title }];
    const related = posts.filter((o) => o.slug !== p.slug && (!cat || o.categories.some((oc) => oc.slug === cat.slug))).slice(0, 3);
    const fill = related.length < 3 ? posts.filter((o) => o.slug !== p.slug && !related.includes(o)).slice(0, 3 - related.length) : [];
    write(`${postPath(p.slug).slice(1)}index.html`, layout({
      title: `${p.seoTitle} | Bolt Answering`,
      description: p.description,
      canonical: abs(postPath(p.slug)),
      ogType: 'article',
      ogImage: p.image ? abs(p.image.og) : undefined,
      published: p.datePublished,
      modified: p.dateModified,
      jsonLd: [articleJsonLd(p), breadcrumbJsonLd(crumbs), ...(p.faq.length ? [faqJsonLd(p.faq)] : [])],
      body: chrome(articlePage({ post: p, html: p.html, side: side(p), categories, related: [...related, ...fill] })),
    }));
  }

  // Search (client-side, over a small JSON index). Not indexed: it has no content of its own.
  if (hasPosts) write('blog/search/index.html', layout({
    title: 'Search the Bolt Answering blog',
    description: 'Search Bolt Answering blog posts.',
    canonical: abs('/blog/search/'),
    robots: 'noindex, follow',
    body: chrome(searchPage({ side: side(), categories })),
  }));
  if (hasPosts) write('blog/search-index.json', JSON.stringify(posts.map((p) => ({
    t: p.title, u: postPath(p.slug), d: p.description, c: p.categories.map((c) => c.name).join(', '), x: stripTags(p.html).slice(0, 4000),
  }))));

  // Feeds and crawler files.
  const sitePages = staticPages(repoRoot);
  if (hasPosts) write('blog/feed.xml', rssXml(posts));
  write('sitemap.xml', sitemapXml({ pages: sitePages, posts, categories, listPages: hasPosts ? listPaths : [] }));
  write('robots.txt', robotsTxt());
  write('llms.txt', llmsTxt({ posts, pages: sitePages, pricing: readSoloPricing(repoRoot) }));

  // Remove what we generated last time but not this time; prune stale image sizes.
  const manifestRel = 'blog/.manifest.json';
  const manifestPath = join(repoRoot, manifestRel);
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { files: [], imageDirs: [] };
  const removed = [];
  for (const rel of previous.files) {
    if (!written.has(rel) && existsSync(join(repoRoot, rel))) { rmSync(join(repoRoot, rel)); removed.push(rel); }
  }
  const imageDirs = [...keepImages.keys()];
  for (const slug of previous.imageDirs || []) {
    if (!keepImages.has(slug)) { rmSync(join(repoRoot, 'blog', 'img', slug), { recursive: true, force: true }); removed.push(`blog/img/${slug}/`); }
  }
  for (const [slug, keep] of keepImages) {
    const dir = join(repoRoot, 'blog', 'img', slug);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (!keep.has(f)) { rmSync(join(dir, f)); removed.push(`blog/img/${slug}/${f}`); }
  }
  // Drop now-empty generated directories (e.g. a deleted post's folder).
  for (const rel of removed) {
    let d = dirname(join(repoRoot, rel));
    while (d.startsWith(join(repoRoot, 'blog')) && d !== join(repoRoot, 'blog') && existsSync(d) && readdirSync(d).length === 0) { rmSync(d, { recursive: true }); d = dirname(d); }
  }
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ files: [...written].sort(), imageDirs: imageDirs.sort() }, null, 2) + '\n');

  log(`Built ${posts.length} post(s), ${categories.length} categor(y/ies), ${pages} list page(s). Removed ${removed.length} stale file(s). Right column: ${top ? 'Top 5' : 'Recent posts'}.`);
  for (const w of warnings) log(`WARNING ${w}`);
  return { posts, categories, warnings, removed, written, topPostsError };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--fixtures');
  const fixturesDir = i > -1 ? process.argv[i + 1] : undefined;
  const wpBaseUrl = process.env.WP_BASE_URL;
  if (!fixturesDir && !wpBaseUrl) {
    console.error('Set WP_BASE_URL (e.g. https://cms.boltanswering.com) or pass --fixtures <dir>.');
    process.exit(2);
  }
  const topPosts = { refresh: process.env.TOP_POSTS_REFRESH === '1', gaKey: process.env.GA4_SA_KEY || '', property: process.env.GA4_PROPERTY_ID || undefined };
  build({ fixturesDir, wpBaseUrl, topPosts }).then(({ topPostsError }) => {
    // The blog still builds and publishes; the workflow fails the run after publishing, so a
    // revoked key or a changed Google API can't freeze the Top 5 unnoticed.
    if (!topPostsError) return;
    console.log(`::error title=Top 5 not refreshed::${topPostsError}. The blog still built; the column keeps its last order. Check the GA4_SA_KEY secret.`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'top_posts_failed=1\n');
  }).catch((e) => { console.error(e); process.exit(1); });
}
