// AFMBP-2525 — "Bolt Answering" is the one name search engines read on boltanswering.com, so Google stops
// mixing us up with other companies called Bolt. This proves, for every page on the site (every .html file
// outside blog/ and tools/, or every non-blog URL in the live sitemap):
//   - exactly one canonical link: https://www.boltanswering.com + the page's own path, no parameters;
//   - application-name and og:site_name are "Bolt Answering"; og:type website; og:url is the canonical;
//     og:title and twitter:title repeat the page's <title>; og:description and twitter:description repeat its
//     meta description (and are absent when it has none); og:image is the 1024px logo; twitter:card summary;
//   - the <title> names "Bolt Answering", and no JSON-LD on the page carries a rating or a review;
// the homepage:
//   - the owner's title and description (the trial length is pricing.js's FALLBACK);
//   - the first paragraph under the H1 is still the owner's own (owner, 11-09: "leave this copy alone");
//   - one JSON-LD block (Organization, WebSite, SoftwareApplication) with the owner's names, legal name and
//     profiles, operatingSystem "Web" (iOS joins in December: AFMBP-2528), and an offer equal to pricing.js's
//     offerLd(FALLBACK); the logo it points to exists;
// the trade pages:
//   - "Bolt Answering for <Trade>" in the title and, screen-reader-only, at the start of the H1; phones hide the
//     H1 and show a baked image, so its alt text opens with the same words;
// the footers (home + trades): the owner's "© 2026 hlpr inc." (unchanged), and the
//   Facebook and Instagram icons link to the same two profiles as sameAs;
// privacy and terms name the company "hlpr inc."; styles.css hides .sr-only text (1px, clipped, out of flow); llms.txt opens "# Bolt Answering" and says we are
// independent; the blog generator names the site "Bolt Answering" (and, live, every blog page in the sitemap does).
// Run: node tools/brand-entity-check.mjs [siteRoot]
//      BASE=https://www.boltanswering.com node tools/brand-entity-check.mjs     the same checks on the live site
//      NC=canonical|sitename|title|ogdesc|rating|offer|sameas|social|srspan|mobilealt|srcss|footer|lead|legal|llms|aboutnav|aboutdup|mobileart|aboutfooter|abouth1|aboutcopy|aboutld|sitemap   negative controls on
//      the copy read (file or live); each must FAIL.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const BASE = (process.env.BASE || '').replace(/\/+$/, '');
const NC = process.env.NC || '';
const SITE = 'https://www.boltanswering.com';
const NAME = 'Bolt Answering';
const LOGO = `${SITE}/assets/logo.png`;
const ALT_NAMES = ['BoltAnswering', 'Bolt Answering AI'];
const SAME_AS = ['https://www.facebook.com/profile.php?id=61590229919739', 'https://www.instagram.com/boltanswering/'];
const TRADES = { 'handyman.html': 'Handymen', 'plumbing.html': 'Plumbers', 'electrical.html': 'Electricians', 'hvac.html': 'HVAC Pros', 'general-contractor.html': 'General Contractors' };
const LEAD = 'Bolt does more than answer calls for independent pros. It books jobs, schedules consultations, captures leads, sets up follow-ups, and handles your schedule so you can focus on your work.';
const ORG_DESC = 'Bolt Answering is an AI phone answering service for solo tradespeople. It answers every call, books jobs and follows up.';
const FOOTER = '<p class="footer__copy">&copy; 2026 hlpr inc.</p>';
const INDEPENDENT = "Bolt Answering is an independent product at boltanswering.com and isn't affiliated with other companies that use the name Bolt.";

// ---------- reading: files, or the live site ----------
async function text(path) {
  if (!BASE) return readFileSync(join(ROOT, path), 'utf8');
  const r = await fetch(`${BASE}/${path}`, { redirect: 'manual', headers: { 'user-agent': 'bolt-brand-entity-check' } });
  if (r.status !== 200) throw new Error(`${BASE}/${path}: HTTP ${r.status}`);
  return r.text();
}
const urlPath = (page) => (page === 'index.html' ? '/' : page.endsWith('/index.html') ? `/${page.slice(0, -'index.html'.length)}` : `/${page}`);

async function listPages() {
  if (BASE) {
    const sm = await text('sitemap.xml');
    return [...sm.matchAll(/<loc>https:\/\/www\.boltanswering\.com(\/[^<]*)<\/loc>/g)]
      .map((m) => m[1]).filter((p) => !p.startsWith('/blog/'))
      .map((p) => (p === '/' ? 'index.html' : p.endsWith('/') ? `${p.slice(1)}index.html` : p.slice(1)));
  }
  const skip = new Set(['blog', 'tools', 'vendor', 'node_modules', 'assets']);
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (!skip.has(name) && !name.startsWith('.')) walk(full); continue; }
      if (name.endsWith('.html') && name !== '404.html') out.push(relative(ROOT, full).split('\\').join('/'));
    }
  };
  walk(ROOT);
  return out.sort();
}

// ---------- negative controls: break the copy we read, and prove the break landed ----------
function mutate(file, s) {
  const swap = (old, neu) => { assert.ok(s.includes(old), `NC=${NC}: anchor missing in ${file}`); const t = s.replace(old, neu); assert.notEqual(t, s); return t; };
  const re = (rx, neu) => { const t = s.replace(rx, neu); assert.notEqual(t, s, `NC=${NC}: pattern missing in ${file}`); return t; };
  if (NC === 'canonical' && file === 'handyman.html') return swap('<link rel="canonical" href="https://www.boltanswering.com/handyman.html" />\n', '');
  if (NC === 'sitename' && file === 'index.html') return swap('<meta property="og:site_name" content="Bolt Answering" />', '<meta property="og:site_name" content="Bolt" />');
  if (NC === 'title' && file === 'handyman.html') return swap('<title>Bolt Answering for Handymen ', '<title>Bolt for Handymen ');
  if (NC === 'ogdesc' && file === 'electrical.html') return re(/(<meta property="og:description" content=")([^"]*)/, '$1Bolt answers.');
  if (NC === 'rating' && file === 'index.html') return swap('"applicationCategory": "BusinessApplication",', '"applicationCategory": "BusinessApplication", "aggregateRating": {"@type": "AggregateRating", "ratingValue": "4.9", "ratingCount": "12"},');
  if (NC === 'offer' && file === 'index.html') return swap('"price": 59,', '"price": 49,');
  if (NC === 'sameas' && file === 'index.html') return swap('"https://www.instagram.com/boltanswering/"', '"https://www.instagram.com/boltanswering/", "https://www.linkedin.com/company/bolt"');
  if (NC === 'mobilealt' && file === 'general-contractor.html') return swap('alt="Bolt Answering for General Contractors: ', 'alt="');
  if (NC === 'social' && file === 'electrical.html') return swap('<a href="https://www.instagram.com/boltanswering/" class="footer__icon"', '<a href="#" class="footer__icon"');
  if (NC === 'legal' && file === 'terms/index.html') return swap('refers to hlpr inc., 9180', 'refers to hlpr, 9180');
  if (NC === 'aboutdup' && file === 'about/index.html') return swap('<a href="/about/" aria-current="page">About</a>\n', '<a href="/about/" aria-current="page">About</a>\n      <a href="/about/">About</a>\n');
  if (NC === 'mobileart' && file === 'about/index.html') return re(/<img class="about__art-m about__art-m--woman"[^>]*\/>\s*/, '');
  if (NC === 'aboutnav' && file === 'support/index.html') return swap('<li><a href="/about/">About</a></li>', '');
  if (NC === 'aboutfooter' && file === 'hvac.html') return swap('<a href="/about/">About</a>', '');
  if (NC === 'abouth1' && file === 'about/index.html') return swap('<span class="sr-only">About Bolt Answering: </span>', '');
  if (NC === 'aboutcopy' && file === 'about/index.html') return swap('Bolt has a smaller job', 'Bolt Answering has a smaller job');
  if (NC === 'aboutld' && file === 'about/index.html') return swap('"@id": "https://www.boltanswering.com/#organization"', '"@id": "https://www.boltanswering.com/#org"');
  if (NC === 'sitemap' && file === 'sitemap.xml') return swap('  <url><loc>https://www.boltanswering.com/about/</loc></url>\n', '');
  if (NC === 'srspan' && file === 'plumbing.html') return swap('<span class="sr-only">Bolt Answering for Plumbers: </span>', '');
  if (NC === 'srcss' && file === 'styles.css') return re(/\n\.sr-only\{[^}]*\}/, '');
  if (NC === 'footer' && file === 'hvac.html') return swap(FOOTER, '<p class="footer__copy">&copy; 2026 Bolt Answering &middot; hlpr inc.</p>');
  if (NC === 'lead' && file === 'index.html') return re(/(<p class="hero__lead[^>]*>)[^<]*/, '$1Bolt Answering is a smart assistant for handymen, plumbers, electricians, HVAC pros and general contractors.');
  if (NC === 'llms' && file === 'llms.txt') return swap('# Bolt Answering\n', '# Bolt\n');
  return s;
}
const read = async (file) => mutate(file, await text(file));

// ---------- checks ----------
let n = 0;
const fails = [];
function check(label, fn) {
  n++;
  try { fn(); } catch (e) { fails.push(`${label}: ${e.message.split('\n')[0]}`); }
}
const attr = (head, re) => [...head.matchAll(re)].map((m) => m[1]);
const meta = (head, key, val) => attr(head, new RegExp(`<meta ${key}="${val.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')}" content="([^"]*)"`, 'g'));
function jsonLd(html) {
  return [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}
function hasKeyDeep(o, keys) {
  if (Array.isArray(o)) return o.some((x) => hasKeyDeep(x, keys));
  if (o && typeof o === 'object') return Object.keys(o).some((k) => keys.includes(k) || hasKeyDeep(o[k], keys));
  return false;
}

const pricingSrc = await text('pricing.js');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(pricingSrc, sandbox);
const P = sandbox.module.exports;
const HOME_TITLE = 'Bolt Answering: Smart Assistants for Handymen &amp; Contractors';
const HOME_DESC = `Bolt Answering is an AI phone answering service for solo tradespeople. It answers every call, books jobs and follows up. Start a ${P.FALLBACK.trialDays}-day free trial.`;

const pages = await listPages();
check('the site has its 13 known pages (and any new page is checked too)', () => assert.ok(pages.length >= 13, `found ${pages.length}`));

for (const page of pages) {
  const html = await read(page);
  const head = html.slice(0, html.indexOf('</head>'));
  const title = (head.match(/<title>([^<]*)<\/title>/) || [])[1];
  const desc = meta(head, 'name', 'description')[0];
  const canon = SITE + urlPath(page);
  check(`${page}: one canonical, ${canon}`, () => assert.deepEqual(attr(head, /<link rel="canonical" href="([^"]*)"/g), [canon]));
  check(`${page}: no other canonical spelling`, () => assert.equal((html.match(/rel=["']canonical["']/g) || []).length, 1));
  check(`${page}: application-name`, () => assert.deepEqual(meta(head, 'name', 'application-name'), [NAME]));
  check(`${page}: og:site_name`, () => assert.deepEqual(meta(head, 'property', 'og:site_name'), [NAME]));
  check(`${page}: og:type`, () => assert.deepEqual(meta(head, 'property', 'og:type'), ['website']));
  check(`${page}: og:url is the canonical`, () => assert.deepEqual(meta(head, 'property', 'og:url'), [canon]));
  check(`${page}: og:title and twitter:title repeat the title`, () => {
    assert.ok(title, 'no <title>');
    assert.deepEqual(meta(head, 'property', 'og:title'), [title]);
    assert.deepEqual(meta(head, 'name', 'twitter:title'), [title]);
  });
  check(`${page}: og/twitter descriptions repeat the meta description`, () => {
    assert.deepEqual(meta(head, 'property', 'og:description'), desc === undefined ? [] : [desc]);
    assert.deepEqual(meta(head, 'name', 'twitter:description'), desc === undefined ? [] : [desc]);
  });
  check(`${page}: og:image is the logo, twitter card summary`, () => {
    assert.deepEqual(meta(head, 'property', 'og:image'), [LOGO]);
    assert.deepEqual(meta(head, 'name', 'twitter:card'), ['summary']);
  });
  check(`${page}: the title names ${NAME}`, () => assert.ok(title && title.includes(NAME), `title "${title}"`));
  check(`${page}: no JSON-LD rating or review`, () => assert.ok(!jsonLd(html).some((d) => hasKeyDeep(d, ['aggregateRating', 'review', 'reviews']))));

  if (page === 'index.html') {
    check('home: the owner\'s title', () => assert.equal(title, HOME_TITLE));
    check('home: the owner\'s description (trial length = pricing.js FALLBACK)', () => assert.equal(desc, HOME_DESC));
    check('home: the first paragraph under the H1 is the owner\'s, unchanged', () => {
      const lead = (html.match(/<p class="hero__lead[^>]*>([^<]*)<\/p>/) || [])[1] || '';
      assert.equal(lead, LEAD);
      assert.ok(html.indexOf('hero__lead') > html.indexOf('</h1>'), 'the paragraph comes after the H1');
    });
    const docs = jsonLd(html);
    check('home: exactly one JSON-LD block, the js-ld-offer one', () => {
      assert.equal(docs.length, 1);
      assert.equal((html.match(/<script type="application\/ld\+json" class="js-ld-offer">/g) || []).length, 1);
    });
    const g = docs[0]?.['@graph'] || [];
    const node = (t) => g.find((x) => x['@type'] === t) || {};
    check('home JSON-LD: Organization, WebSite, SoftwareApplication and nothing else', () =>
      assert.deepEqual(g.map((x) => x['@type']), ['Organization', 'WebSite', 'SoftwareApplication']));
    check('home JSON-LD: Organization names, legal name, url, logo', () => {
      const o = node('Organization');
      assert.equal(o.name, NAME);
      assert.deepEqual(o.alternateName, ALT_NAMES);
      assert.equal(o.legalName, 'hlpr inc.');
      assert.equal(o.url, `${SITE}/`);
      assert.equal(o.logo?.url, LOGO);
    });
    check('home JSON-LD: sameAs is exactly the owner\'s two profiles', () => assert.deepEqual(node('Organization').sameAs, SAME_AS));
    check('home JSON-LD: WebSite names and url', () => {
      const w = node('WebSite');
      assert.equal(w.name, NAME);
      assert.deepEqual(w.alternateName, ALT_NAMES);
      assert.equal(w.url, `${SITE}/`);
    });
    check('home JSON-LD: SoftwareApplication is a web business app', () => {
      const a = node('SoftwareApplication');
      assert.equal(a.name, NAME);
      assert.equal(a.applicationCategory, 'BusinessApplication');
      assert.equal(a.operatingSystem, 'Web');
      assert.equal(a.description, ORG_DESC);
    });
    check('home JSON-LD: the offer is pricing.js offerLd(FALLBACK) (the price the page shows)', () =>
      assert.deepEqual(JSON.parse(JSON.stringify(node('SoftwareApplication').offers)), JSON.parse(JSON.stringify(P.offerLd(P.FALLBACK)))));
    if (BASE) {
      const r = await fetch(LOGO, { method: 'HEAD' });
      check('home JSON-LD: the logo serves (200 image/png)', () => { assert.equal(r.status, 200); assert.match(r.headers.get('content-type') || '', /image\/png/); });
    } else {
      check('home JSON-LD: the logo file exists', () => assert.ok(existsSync(join(ROOT, 'assets/logo.png'))));
    }
  }

  check(`${page}: at most one About link in the nav and one in the footer`, () =>
    assert.equal((html.match(/href="\/about\/"/g) || []).length, (html.includes('class="nav__links"') ? 1 : 0) + (html.includes('class="footer__menu"') ? 1 : 0)));
  if (html.includes('class="nav__links"')) {
    check(`${page}: the nav links to /about/ right after Home`, () =>
      assert.match(html, /<li><a href="(?:#top|index\.html|\/)">Home<\/a><\/li>\s*<li><a href="\/about\/"( aria-current="page")?>About<\/a><\/li>/));
  }
  if (html.includes('class="footer__menu"')) {
    check(`${page}: the footer links to /about/ right after Home`, () =>
      assert.match(html, /<a href="(?:#top|index\.html|\/)">Home<\/a>\s*<a href="\/about\/"( aria-current="page")?>About<\/a>/));
  }
  if (page === 'about/index.html') {
    check('about: title "About Bolt Answering — Never miss a job again"', () => assert.equal(title, 'About Bolt Answering — Never miss a job again'));
    check('about: the description is the owner\'s homepage description, verbatim', () => assert.equal(desc, HOME_DESC));
    check('about: the H1 opens with screen-reader-only "About Bolt Answering: "', () =>
      assert.ok(html.includes('<h1 class="hero__title about__title"><span class="sr-only">About Bolt Answering: </span>')));
    check('about: AboutPage JSON-LD points at the homepage\'s Organization and WebSite', () => {
      const d = jsonLd(html);
      assert.equal(d.length, 1);
      assert.equal(d[0]['@type'], 'AboutPage');
      assert.equal(d[0].url, canon);
      assert.deepEqual(d[0].about, { '@id': `${SITE}/#organization` });
      assert.deepEqual(d[0].isPartOf, { '@id': `${SITE}/#website` });
    });
    check('about: phones get the node\'s four drawings too (decorative, alt=""), one before each passage', () => {
      for (const [kind, before] of [['man', '<p>When the heat goes out'], ['attic', '<p>The usual answer is a receptionist.'], ['woman', '<ol class="about__list">'], ['wave', '<ol class="about__list about__list--last">']])
        assert.match(html, new RegExp(`<img class="about__art-m about__art-m--${kind}" src="/assets/about/[a-z-]+\\.webp" alt="" [^>]*/>\\s*${before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    });
    check('about: the nav and footer mark About as the current page', () => assert.equal((html.match(/<a href="\/about\/" aria-current="page">About<\/a>/g) || []).length, 2));
    check('about: the owner\'s node copy, verbatim (first paragraph; 6 + 5 list items; the trial length follows pricing.js)', () => {
      assert.ok(html.includes('<p>When the heat goes out in January or a pipe lets go on a Sunday, a family calls you. That trust took years to earn, and no assistant replaces it. Bolt has a smaller job: make sure that call reaches you.</p>'));
      assert.deepEqual([...html.matchAll(/<ol class="about__list[^"]*">([\s\S]*?)<\/ol>/g)].map((m) => (m[1].match(/<li>/g) || []).length), [6, 5]);
      assert.equal((html.match(/<span class="js-td">30<\/span>/g) || []).length, 3);
    });
  }
  if (TRADES[page]) {
    const noun = TRADES[page];
    check(`${page}: title "Bolt Answering for ${noun} …"`, () => assert.ok(title?.startsWith(`${NAME} for ${noun} `), `title "${title}"`));
    check(`${page}: the H1 opens with screen-reader-only "Bolt Answering for ${noun}: "`, () =>
      assert.ok(html.includes(`<h1 class="tphero__title rv" data-rd="120"><span class="sr-only">${NAME} for ${noun}: </span>`)));
    check(`${page}: phones show a baked hero image instead of the H1; its alt opens with "Bolt Answering for ${noun}: "`, () =>
      assert.match(html, new RegExp(`<img class="tphero__mobileimg" src="[^"]*" alt="${NAME} for ${noun}: `)));
  }
  if (page === 'index.html' || TRADES[page] || page === 'about/index.html') {
    check(`${page}: the footer's Facebook and Instagram icons link to the sameAs profiles`, () => {
      assert.deepEqual(attr(html, /<a href="([^"]*)" class="footer__icon"/g), SAME_AS);
    });
    check(`${page}: footer is the owner's "© 2026 hlpr inc."`, () => assert.ok(html.includes(FOOTER)));
  }
}

for (const [file, words] of [['privacy/index.html', 'means hlpr inc., 9180 Alcosta'], ['terms/index.html', 'refers to hlpr inc., 9180 Alcosta']]) {
  const h = await read(file);
  check(`${file}: the company is "hlpr inc." (owner, 11-09)`, () => assert.ok(h.includes(words)));
}

const css = await read('styles.css');
check('styles.css: the phone drawings show only on phones (hidden on desktop, absolute and behind the text on phones)', () => {
  assert.ok(css.includes('.about__art-m{display:none}'));
  assert.match(css, /@media \(max-width:768px\)\{\n  \.about__art\{display:none\}\n  \.about__art-m\{display:block;position:absolute;z-index:-1;/);
});
check('styles.css: .sr-only takes no space and paints nothing', () => {
  const rule = (css.match(/\n\.sr-only\{([^}]*)\}/) || [])[1] || '';
  for (const d of ['position:absolute!important', 'width:1px!important', 'height:1px!important', 'overflow:hidden!important', 'clip-path:inset(50%)!important', 'white-space:nowrap!important', 'margin:-1px!important'])
    assert.ok(rule.includes(d), `missing ${d}`);
});

const sitemap = await read('sitemap.xml');
check('sitemap.xml lists /about/ (the blog build adds every indexable page; this line is the same)', () =>
  assert.ok(sitemap.includes('<url><loc>https://www.boltanswering.com/about/</loc></url>')));
const llms = await read('llms.txt');
check('llms.txt lists the About page', () => assert.ok(llms.includes('- [About](https://www.boltanswering.com/about/)\n')));
check('llms.txt opens "# Bolt Answering" and says we are independent', () => {
  assert.ok(llms.startsWith('# Bolt Answering\n'));
  assert.ok(llms.includes(INDEPENDENT));
});

if (!BASE) {
  check('blog generator: site name, post titles and llms.txt say Bolt Answering', () => {
    assert.ok(readFileSync(join(ROOT, 'tools/blog/lib/util.mjs'), 'utf8').includes("export const SITE_NAME = 'Bolt Answering';"));
    assert.ok(readFileSync(join(ROOT, 'tools/blog/build.mjs'), 'utf8').includes('title: `${p.seoTitle} | Bolt Answering`,'));
    assert.ok(readFileSync(join(ROOT, 'tools/blog/lib/seo.mjs'), 'utf8').includes("'# Bolt Answering',"));
  });
} else {
  const sm = await text('sitemap.xml');
  const blog = [...sm.matchAll(/<loc>https:\/\/www\.boltanswering\.com(\/blog\/[^<]*)<\/loc>/g)].map((m) => m[1].slice(1));
  check('live blog: the sitemap lists blog pages', () => assert.ok(blog.length >= 1));
  for (const b of blog) {
    const h = await text(b);
    check(`${b}: og:site_name and title say ${NAME}`, () => {
      assert.deepEqual(meta(h, 'property', 'og:site_name'), [NAME]);
      assert.ok(((h.match(/<title>([^<]*)<\/title>/) || [])[1] || '').includes(NAME));
    });
  }
}

console.log(`${n} checks, ${fails.length} failed${NC ? ` (NC=${NC})` : ''}${BASE ? ` on ${BASE}` : ''}`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
