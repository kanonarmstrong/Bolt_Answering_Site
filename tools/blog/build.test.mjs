/* Blog build tests. Run: cd tools/blog && npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import { sanitize, rewriteLinks, extractFaq, isAllowedImageHost } from './lib/content.mjs';
import { normalize } from './lib/wp.mjs';
import { changedUrls } from './indexnow.mjs';
import { parseDraft, toWxr } from './make-wxr.mjs';
import { transformCss } from './prepare-assets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures', 'wp');
const quiet = () => {};

/** A throwaway repo root with a couple of hand-made marketing pages. */
function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'bolt-blog-'));
  writeFileSync(join(root, 'index.html'), '<html><head><title>Home</title></head></html>');
  // Stand-ins for the site pages the blog copies its header and footer from (lib/chrome.mjs).
  mkdirSync(join(root, 'support'));
  writeFileSync(join(root, 'support', 'index.html'), `<html><head>
  <link rel="stylesheet" href="/assets/fonts.css?v=1" />
  <link rel="stylesheet" href="/styles.css?v=53" />
  <link rel="stylesheet" href="/support/support.css?v=5" />
</head><body>
  <header class="nav" id="top"><a href="/" class="logo"><img src="/assets/logo-wordmark.png" alt="Bolt" /></a>
    <ul class="nav__links"><li class="nav__dropdown nav__dropdown--community"><a href="#" class="nav__dropdown-trigger">Community</a>
      <ul class="nav__dropdown-menu"><li><a href="/blog/">Blog</a></li><li><a href="/support">Support</a></li></ul></li></ul>
  </header>
  <main>support</main></body></html>`);
  writeFileSync(join(root, 'hvac.html'), `<html><head><title>HVAC</title></head><body>
  <footer class="footer"><nav class="footer__menu"><a href="index.html">Home</a><a href="#pricing">Pricing</a><a href="index.html#how">How</a><a href="#">FB</a><a href="/terms/">Terms</a></nav></footer>

  <a href="https://app.boltanswering.com/signup" class="btn btn--yellow floating-cta">Get started now</a>
  <script src="pricing.js?v=7"></script>
  <script src="script.js?v=29"></script>
  <script src="demo.js?v=46"></script>
</body></html>`);
  mkdirSync(join(root, 'deletemydata'));
  writeFileSync(join(root, 'deletemydata', 'index.html'), '<html><head><meta name="robots" content="noindex"></head></html>');
  return root;
}
const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test('sanitize drops scripts, event handlers and iframes, and demotes h1 to h2', () => {
  const out = sanitize('<h1>T</h1><script>alert(1)</script><p onclick="x()">Hi</p><iframe src="https://x"></iframe><p></p>');
  assert.equal(out, '<h2>T</h2><p>Hi</p>');
});

test('links to the WordPress copy of a post are rewritten to /blog/<slug>/', () => {
  const linkMap = new Map([['/why-pe-buys-shops/', 'why-pe-buys-shops'], ['?p=101', 'answer-every-call']]);
  const html = rewriteLinks('<a href="https://cms.example.test/why-pe-buys-shops/#x">a</a> <a href="https://cms.example.test/?p=101">b</a> <a href="https://other.test/" target="_blank">c</a>', { wpHost: 'cms.example.test', linkMap });
  assert.match(html, /href="\/blog\/why-pe-buys-shops\/#x"/);
  assert.match(html, /href="\/blog\/answer-every-call\/"/);
  assert.match(html, /href="https:\/\/other\.test\/" target="_blank" rel="noopener"/);
});

test('FAQ sections are found from h3 questions and bold-paragraph questions', () => {
  const faq = extractFaq('<p>x</p><h2>FAQ</h2><h3>One?</h3><p>Yes.</p><p><strong>Two?</strong><br>No.</p><h2>Next</h2><h3>Not this?</h3><p>z</p>');
  assert.deepEqual(faq, [{ q: 'One?', a: 'Yes.' }, { q: 'Two?', a: 'No.' }]);
  assert.deepEqual(extractFaq('<h2>Other</h2><h3>Q?</h3><p>A</p>'), []);
});

test('images are only downloaded from WordPress hosts', () => {
  assert.ok(isAllowedImageHost('cms.boltanswering.com', 'cms.boltanswering.com'));
  assert.ok(isAllowedImageHost('i0.wp.com', 'cms.boltanswering.com'));
  assert.ok(isAllowedImageHost('boltblog.files.wordpress.com', 'cms.boltanswering.com'));
  assert.ok(!isAllowedImageHost('evil.example.com', 'cms.boltanswering.com'));
});

test('drafts and other unpublished posts never reach the site', () => {
  const { posts } = normalize({ categories: [], posts: [
    { id: 1, status: 'draft', slug: 'secret', title: { rendered: 'S' }, content: { rendered: '' }, date: '2026-01-01T00:00:00' },
    { id: 2, status: 'publish', slug: 'ok', title: { rendered: 'O' }, content: { rendered: '' }, date: '2026-01-01T00:00:00' },
  ] });
  assert.deepEqual(posts.map((p) => p.slug), ['ok']);
});

test('a fixture build produces crawlable pages with correct SEO wiring', async () => {
  const root = tempRepo();
  const { warnings } = await build({ repoRoot: root, fixturesDir: FIX, log: quiet });

  for (const rel of ['blog/index.html', 'blog/answer-every-call/index.html', 'blog/why-pe-buys-shops/index.html', 'blog/no-image-post/index.html',
    'blog/category/missed-calls-booking/index.html', 'blog/search/index.html', 'blog/feed.xml', 'blog/search-index.json', 'sitemap.xml', 'robots.txt', 'llms.txt']) {
    assert.ok(existsSync(join(root, rel)), `missing ${rel}`);
  }
  assert.ok(!existsSync(join(root, 'blog/category/empty-category/index.html')), 'empty category gets no page');
  assert.ok(!existsSync(join(root, 'blog/category/uncategorized/index.html')), 'Uncategorized gets no page');

  const art = read(root, 'blog/answer-every-call/index.html');
  // "the bottom line" masthead on every page: the <h1> on the blog home (no breadcrumb line), a link home elsewhere.
  const home = read(root, 'blog/index.html');
  assert.equal((home.match(/<h1[\s>]/g) || []).length, 1, 'blog home: exactly one h1');
  assert.match(home, /<h1 class="masthead_title"><img src="\/blog\/assets\/img\/the-bottom-line\.svg" alt="the bottom line"/);
  assert.doesNotMatch(home, /class="breadcrumbs"|class="pagetitle"/, 'blog home: masthead replaces the title and breadcrumb lines');
  assert.match(art, /<div class="masthead_title"><a href="\/blog\/"><img src="\/blog\/assets\/img\/the-bottom-line\.svg"/);
  assert.doesNotMatch(art, /class="breadcrumbs"/, 'posts: no visible breadcrumb line');
  assert.doesNotMatch(art, /class="pagetitle"/);
  // Search: one field in the masthead (desktop) and one right after Recent posts (phones), with
  // distinct ids; no old sidebar search or sidebar CTA box.
  for (const page of [home, art]) {
    assert.equal((page.match(/class="msearch js-search"/g) || []).length, 2, 'masthead + sidebar search forms');
    assert.match(page, /class="masthead_search"[\s\S]*id="blog-q"/);
    assert.match(page, /<h3>Recent posts<\/h3>[\s\S]*?<div class="sidebar_widget sidebar_msearch">\s*<form[^>]*>[\s\S]*?id="blog-q-side"/);
    assert.ok(page.indexOf('sidebar_msearch') < page.indexOf('<h3>Categories</h3>') || !page.includes('<h3>Categories</h3>'), 'phone search sits before Categories');
    assert.match(page, /<form action="\/blog\/search\/" method="get" role="search"/);
    assert.doesNotMatch(page, /sidebar_search|sidebar_cta|Never miss a job again/);
  }
  // Post cards end their excerpt with a plain "Read more" link, not a button.
  assert.match(home, /<p class="article_desc">[^<]* <a href="\/blog\/answer-every-call\/" class="article_more" aria-label="Read more: [^"]+">Read more<\/a><\/p>/);
  assert.doesNotMatch(home, /article_btn/);
  // Date | read-time stamp, no author.
  assert.match(home, /<div class="infoline_date"><time datetime="2026-11-01T16:00:00\.000Z">Nov 1, 2026<\/time><\/div><span class="infoline_sep" aria-hidden="true">\|<\/span><div class="infoline_tag">\d+ min read<\/div>/);
  assert.doesNotMatch(art, /infoline_author/);
  assert.match(art, /<div class="stories_item_infoline infoline">\s*<div class="infoline_date"><time[^>]*>[A-Z][a-z]{2} \d{1,2}, \d{4}<\/time><\/div><span class="infoline_sep" aria-hidden="true">\|<\/span><div class="infoline_tag">\d+ min read<\/div>/, 'Recent posts use the same stamp');
  // Author Gravatar: self-hosted, before the name; posts by authors without one get none.
  assert.match(art, /<div class="author_name"><img class="author_avatar" src="\/blog\/img\/answer-every-call\/[0-9a-f]{10}-avatar\.webp" alt="" width="20" height="20" \/><span>Kanon Armstrong<\/span><\/div>/);
  assert.ok(readdirSync(join(root, 'blog/img/answer-every-call')).some((f) => f.endsWith('-avatar.webp')), 'avatar file written');
  assert.match(read(root, 'blog/why-pe-buys-shops/index.html'), /<div class="author_name"><span>Kanon Armstrong<\/span><\/div>/);
  const cat = read(root, 'blog/category/missed-calls-booking/index.html');
  assert.equal((cat.match(/<h1[\s>]/g) || []).length, 1, 'category: exactly one h1');
  assert.match(cat, /<div class="masthead_title">/);
  assert.equal((art.match(/<h1[\s>]/g) || []).length, 1, 'exactly one h1');
  assert.match(art, /<link rel="canonical" href="https:\/\/www\.boltanswering\.com\/blog\/answer-every-call\/" \/>/);
  assert.match(art, /<title>Answer Every Call, Even After Hours \| Bolt<\/title>/, 'search title field wins');
  assert.match(art, /<html lang="en">/);
  assert.doesNotMatch(art, /alert\(1\)|onclick|evil\.example\.com|data-src=/);
  assert.doesNotMatch(art, /maximum-scale/, 'pinch zoom is allowed');
  assert.match(art, /property="og:image" content="https:\/\/www\.boltanswering\.com\/blog\/img\/answer-every-call\/[0-9a-f]{10}-og\.jpg"/);
  const types = jsonLd(art).map((d) => d['@type']);
  assert.deepEqual(types, ['BlogPosting', 'BreadcrumbList', 'FAQPage']);
  const posting = jsonLd(art)[0];
  assert.equal(posting.author.name, 'Kanon Armstrong');
  assert.equal(posting.datePublished, '2026-11-01T16:00:00.000Z');
  assert.ok(posting.wordCount > 10);

  // Every post image on the page is a local, resized file with alt + dimensions.
  for (const tag of art.match(/<img\b[^>]*>/g)) {
    if (tag.includes('logo-wordmark') || tag.includes('/blog/assets/img/')) continue; // site chrome + masthead
    assert.match(tag, /src="\/blog\/img\/[a-z0-9-]+\/[0-9a-f]{10}-(?:\d+|avatar)\.webp"/, 'local, resized image');
    assert.match(tag, /width="\d+" height="\d+"/);
    assert.match(tag, /alt="/);
  }
  assert.ok(warnings.some((w) => /without alt text/.test(w)));
  assert.ok(warnings.some((w) => /evil\.example\.com/.test(w)));
  assert.ok(warnings.some((w) => /no featured image/.test(w)));

  const sitemap = read(root, 'sitemap.xml');
  assert.match(sitemap, /<loc>https:\/\/www\.boltanswering\.com\/blog\/answer-every-call\/<\/loc><lastmod>2026-11-03<\/lastmod>/);
  assert.match(sitemap, /<loc>https:\/\/www\.boltanswering\.com\/hvac\.html<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.boltanswering\.com\/<\/loc>/);
  assert.doesNotMatch(sitemap, /deletemydata/, 'noindex pages stay out of the sitemap');
  assert.doesNotMatch(sitemap, /blog\/search\//, 'search page stays out of the sitemap');

  const robots = read(root, 'robots.txt');
  assert.match(robots, /User-agent: GPTBot/);
  assert.match(robots, /User-agent: ClaudeBot/);
  assert.doesNotMatch(robots, /Disallow: \//);
  assert.match(robots, /Sitemap: https:\/\/www\.boltanswering\.com\/sitemap\.xml/);
  assert.match(read(root, 'blog/search/index.html'), /content="noindex, follow"/);
  assert.match(read(root, 'llms.txt'), /\[Why private equity buys trades shops\]\(https:\/\/www\.boltanswering\.com\/blog\/why-pe-buys-shops\/\)/);
  assert.match(read(root, 'blog/feed.xml'), /<content:encoded><!\[CDATA\[/);
  const index = JSON.parse(read(root, 'blog/search-index.json'));
  assert.equal(index.length, 3);
});

test('a second build with the same content changes nothing', async () => {
  const root = tempRepo();
  await build({ repoRoot: root, fixturesDir: FIX, log: quiet });
  const snap = () => {
    const out = {};
    const walk = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const f = join(d, n.name); if (n.isDirectory()) walk(f); else out[f] = createHash('sha1').update(readFileSync(f)).digest('hex'); } };
    walk(root);
    return out;
  };
  const before = snap();
  await build({ repoRoot: root, fixturesDir: FIX, log: quiet });
  assert.deepEqual(snap(), before);
});

test('unpublishing a post removes its page and images, and leaves hand-made files alone', async () => {
  const root = tempRepo();
  const fix = mkdtempSync(join(tmpdir(), 'bolt-fix-'));
  cpSync(FIX, fix, { recursive: true });
  await build({ repoRoot: root, fixturesDir: fix, log: quiet });
  assert.ok(existsSync(join(root, 'blog/why-pe-buys-shops/index.html')));
  writeFileSync(join(root, 'blog', 'hand-made.html'), 'keep me');

  const posts = JSON.parse(readFileSync(join(fix, 'posts.json'), 'utf8')).filter((p) => p.slug !== 'why-pe-buys-shops');
  writeFileSync(join(fix, 'posts.json'), JSON.stringify(posts));
  const { removed } = await build({ repoRoot: root, fixturesDir: fix, log: quiet });

  assert.ok(!existsSync(join(root, 'blog/why-pe-buys-shops')), 'post folder removed');
  assert.ok(!existsSync(join(root, 'blog/img/why-pe-buys-shops')), 'post images removed');
  assert.ok(!existsSync(join(root, 'blog/category/running-the-business')), 'now-empty category removed');
  assert.ok(existsSync(join(root, 'blog/hand-made.html')), 'hand-made file kept');
  assert.ok(existsSync(join(root, 'hvac.html')));
  assert.doesNotMatch(read(root, 'sitemap.xml'), /why-pe-buys-shops/);
  assert.ok(removed.includes('blog/why-pe-buys-shops/index.html'));
});

test('IndexNow pings changed pages and feeds only', () => {
  assert.deepEqual(changedUrls(['blog/a/index.html', 'blog/index.html', 'blog/img/a/x.webp', 'sitemap.xml', 'styles.css']).sort(), [
    'https://www.boltanswering.com/blog/', 'https://www.boltanswering.com/blog/a/', 'https://www.boltanswering.com/sitemap.xml',
  ]);
});

test('make-wxr turns a markdown draft into a WordPress draft and skips held posts', () => {
  const d = parseDraft('---\ntitle_tag: Search T\nmeta_description: Desc.\nslug: /blog/my-post\ncategory: How Bolt Works\n---\n\n# My post\n\nHello **there**.\n', 'x.md');
  assert.equal(d.title, 'My post');
  assert.equal(d.slug, 'my-post');
  assert.equal(d.category, 'How Bolt Works');
  assert.doesNotMatch(d.html, /<h1>/);
  const xml = toWxr([d]);
  assert.match(xml, /<wp:status><!\[CDATA\[draft\]\]><\/wp:status>/);
  assert.match(xml, /<wp:meta_key><!\[CDATA\[bolt_seo_title\]\]><\/wp:meta_key><wp:meta_value><!\[CDATA\[Search T\]\]>/);
  assert.equal(parseDraft('---\nSTATUS: DO NOT PUBLISH\n---\n# Held', 'h.md').skip, true);
});

test('template CSS is recolored to Bolt blue and Inter', () => {
  const css = transformCss('a{color:#D93D59;font-family:"Jost", sans-serif;box-shadow:0 0 1px rgba(217, 61, 89, 0.2)}');
  assert.doesNotMatch(css, /d93d59|Jost|217, 61, 89/i);
  assert.match(css, /#2b7ffd/);
  assert.match(css, /'Inter'/);
});

test('with no published posts, only robots.txt, sitemap.xml and llms.txt are written', async () => {
  const root = tempRepo();
  await build({ repoRoot: root, fixturesDir: join(HERE, 'fixtures', 'empty'), log: quiet });
  assert.ok(existsSync(join(root, 'robots.txt')));
  assert.ok(existsSync(join(root, 'llms.txt')));
  assert.ok(!existsSync(join(root, 'blog/index.html')), 'no empty blog page');
  const sitemap = read(root, 'sitemap.xml');
  assert.match(sitemap, /hvac\.html/);
  assert.doesNotMatch(sitemap, /\/blog\//);
  assert.doesNotMatch(read(root, 'llms.txt'), /## Blog/);
});

test('WordPress.com "simple" sites are read through public-api.wordpress.com', async () => {
  const { apiBaseFromLink, discoverApiBase } = await import('./lib/wp.mjs');
  assert.equal(apiBaseFromLink('https://public-api.wordpress.com/wp-json/?rest_route=/sites/boltcms.wordpress.com'), 'https://public-api.wordpress.com/wp/v2/sites/boltcms.wordpress.com');
  assert.equal(apiBaseFromLink('https://cms.example.com/wp-json/'), 'https://cms.example.com/wp-json/wp/v2');

  const realFetch = globalThis.fetch;
  const saved = process.env.WP_API_BASE;
  delete process.env.WP_API_BASE;
  try {
    globalThis.fetch = async () => new Response(null, { headers: { link: '<https://public-api.wordpress.com/wp-json/?rest_route=/sites/x.wordpress.com>; rel="https://api.w.org/", <https://wp.me/a>; rel=shortlink' } });
    assert.equal(await discoverApiBase('https://cms.example.com'), 'https://public-api.wordpress.com/wp/v2/sites/x.wordpress.com');
    globalThis.fetch = async () => new Response(null, {});
    assert.equal(await discoverApiBase('https://cms.example.com'), 'https://cms.example.com/wp-json/wp/v2', 'falls back to /wp-json');
    process.env.WP_API_BASE = 'https://override.test/wp/v2/';
    assert.equal(await discoverApiBase('https://cms.example.com'), 'https://override.test/wp/v2');
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.WP_API_BASE; else process.env.WP_API_BASE = saved;
  }
});

test("WordPress.com's built-in SEO fields feed the search title and description", () => {
  const base = { id: 1, status: 'publish', slug: 's', title: { rendered: 'On-page title' }, excerpt: { rendered: '<p>Excerpt.</p>' }, content: { rendered: '<p>Body</p>' }, date: '2026-01-01T00:00:00' };
  const [p] = normalize({ categories: [], posts: [{ ...base, meta: { jetpack_seo_html_title: 'Search title', advanced_seo_description: 'Search description.' } }] }).posts;
  assert.equal(p.seoTitle, 'Search title');
  assert.equal(p.description, 'Search description.');
  const [q] = normalize({ categories: [], posts: [{ ...base, meta: { jetpack_seo_html_title: '', advanced_seo_description: '' } }] }).posts;
  assert.equal(q.seoTitle, 'On-page title');
  assert.equal(q.description, 'Excerpt.');
});

test('blog pages wear the site header and footer, not the template\'s', async () => {
  const root = tempRepo();
  await build({ repoRoot: root, fixturesDir: FIX, log: quiet });
  for (const rel of ['blog/index.html', 'blog/answer-every-call/index.html', 'blog/category/missed-calls-booking/index.html', 'blog/search/index.html']) {
    const h = read(root, rel);
    assert.equal((h.match(/<header class="nav"/g) || []).length, 1, `${rel}: site header once`);
    assert.equal((h.match(/<footer class="footer"/g) || []).length, 1, `${rel}: site footer once`);
    assert.doesNotMatch(h, /header_top|header_mid|header_nav|footer_cols/, `${rel}: no template header/footer`);
    assert.match(h, /<a href="\/blog\/" aria-current="page">Blog<\/a>/);
    assert.match(h, /<link rel="stylesheet" href="\/styles\.css\?v=53" \/>/, 'site stylesheet, same version as the site');
    assert.doesNotMatch(h, /support\.css/, 'page-specific CSS is not copied');
    assert.match(h, /<script src="\/script\.js\?v=29"><\/script>/);
    assert.match(h, /<script src="\/pricing\.js\?v=7"><\/script>/);
    assert.doesNotMatch(h, /demo\.js/, 'page-specific scripts are not copied');
    assert.match(h, /class="btn btn--yellow floating-cta"/);
    // Footer links made absolute so they work from /blog/<post>/.
    assert.match(h, /<a href="\/">Home<\/a><a href="\/#pricing">Pricing<\/a><a href="\/#how">How<\/a><a href="#">FB<\/a>/);
    // Content sits inside the scoped wrapper, between header and footer.
    const iHeader = h.indexOf('</header>'), iBchy = h.indexOf('<div class="bchy">'), iFooter = h.indexOf('<footer class="footer"');
    assert.ok(iHeader < iBchy && iBchy < iFooter, `${rel}: header, then blog content, then footer`);
  }
});

test('relative site links are made absolute', async () => {
  const { absolutizeUrl } = await import('./lib/chrome.mjs');
  assert.equal(absolutizeUrl('index.html'), '/');
  assert.equal(absolutizeUrl('index.html#how'), '/#how');
  assert.equal(absolutizeUrl('#pricing'), '/#pricing');
  assert.equal(absolutizeUrl('#'), '#');
  assert.equal(absolutizeUrl('electrical.html'), '/electrical.html');
  assert.equal(absolutizeUrl('assets/logo.png'), '/assets/logo.png');
  for (const u of ['/support', 'https://app.boltanswering.com/login', 'mailto:a@b.c', 'tel:+1']) assert.equal(absolutizeUrl(u), u);
});

test('template CSS is scoped to the blog content and never styles the site header or footer', () => {
  const css = transformCss('body{margin:0} html { font-size: 10px !important; } @media (max-width:767px){ html { font-size: 9px !important; } } p{font-size:1.8rem;margin:0 -2rem} .footer{order:3} .btn,h1{color:red} @media (max-width:600px){.header a{x:y}} @font-face{font-family:x}');
  assert.match(css, /\.bchy\s*\{margin:0\}/);
  assert.doesNotMatch(css, /(^|[};\s])html[\s,{]/, 'no rule touches the page root');
  assert.match(css, /\.bchy \{ --bchy-rem: 10px; \}/);
  assert.match(css, /@media \(max-width:767px\)\{ \.bchy \{ --bchy-rem: 9px; \}/);
  assert.match(css, /\.bchy p\{font-size:calc\(1\.8 \* var\(--bchy-rem, 10px\)\);/);
  assert.doesNotMatch(css, /\drem\b/, 'no rem left');
  assert.match(css, /margin:0 calc\(-2 \* var\(--bchy-rem, 10px\)\)/, 'negative sizes stay valid');
  assert.doesNotMatch(css, /-calc\(/, 'no invalid -calc(');
  assert.match(css, /\.bchy \.footer\s*\{/);
  assert.match(css, /\.bchy \.btn,\s*\.bchy h1\s*\{/);
  assert.match(css, /\.bchy \.header a\s*\{/);
  assert.match(css, /@font-face\s*\{font-family:x\}/);
  assert.doesNotMatch(css, /(^|[};])\s*\.footer\s*\{/, 'no unscoped .footer rule');
});

test('blog.css sizes follow the blog base size, not the site root', () => {
  const css = readFileSync(join(HERE, '..', '..', 'blog', 'assets', 'css', 'blog.css'), 'utf8');
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\d\s*rem\b/, 'no rem units (they would follow the site\'s 16px root)');
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{/g)) {
    const sel = rule.slice(0, -1).trim();
    if (sel.startsWith('@media') || sel.startsWith('.skip-link') || sel.startsWith('body.blog-page ')) continue; // blog-only by page class
    for (const part of sel.split(',')) assert.match(part.trim(), /^\.bchy\b/, `unscoped selector in blog.css: ${part.trim()}`);
  }
});
