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
  writeFileSync(join(root, 'hvac.html'), '<html><head><title>HVAC</title></head></html>');
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

  // Every image on the page is a local, resized file with alt + dimensions.
  for (const tag of art.match(/<img\b[^>]*>/g)) {
    if (tag.includes('logo-wordmark')) continue;
    assert.match(tag, /src="\/blog\/img\/[a-z0-9-]+\/[0-9a-f]{10}-\d+\.webp"/, 'local, resized image');
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
