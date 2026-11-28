/* AFMBP-2664 — tools/pricing-sync.mjs rebuilds the site's pricing fallback from the published price.
   AFMBP-2720 — and writes the per-day figure ("less than $N a day") from the standard price.
   Run: node --test tools/pricing-sync.test.mjs
   Every test works on a throwaway copy of the files the sync touches, never on the checkout. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { offerFromFeed, syncSite, SyncError, KEYS, fallbackBlock, perDay, PER_DAY_LINES, PER_DAY_TEXT, DRAWN_PER_DAY } from './pricing-sync.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'hvac.html', 'plumbing.html', 'electrical.html', 'handyman.html', 'general-contractor.html', 'support/index.html'];
// The files holding the per-day lines (demo.js, the /start/ template, the About page).
const PER_DAY_FILES = [...new Set(PER_DAY_LINES.map((l) => l.file))];
const START = ['start/handyman.html', 'start/plumbing.html', 'start/general-contractor.html'];
const require = createRequire(import.meta.url);

function copySite() {
  const root = mkdtempSync(join(tmpdir(), 'pricing-sync-'));
  for (const d of ['support', 'about', 'tools']) mkdirSync(join(root, d));
  for (const f of ['pricing.js', ...PAGES, ...PER_DAY_FILES]) cpSync(join(SITE, f), join(root, f));
  return root;
}
const read = (root, f) => readFileSync(join(root, f), 'utf8');
const count = (s, sub) => s.split(sub).length - 1;
const fallbackOf = (root) => {
  const p = join(root, 'pricing.js');
  delete require.cache[require.resolve(p)];
  return require(p).FALLBACK;
};
const committed = fallbackOf(SITE);
const feedWith = (over) => ({ plans: { solo: { plan: 'solo', displayName: 'Solo', ...committed, ...over }, crew: {} }, versions: { solo: 'v', crew: null } });
const LD_RE = /<script type="application\/ld\+json" class="js-ld-offer">([\s\S]*?)<\/script>/;
// A promo length the committed site does not carry, always plural. The first version of these tests
// assumed the committed promo was 1 month; the bot's first sync (2026-11-20) made it 3, and they broke.
const MONTHS = committed.promoMonths >= 2 ? committed.promoMonths + 1 : 3;
const DAY = perDay(committed);
// A standard price one figure up (still under the drawn $4 while DAY is 3), and one in the same band.
const RETAIL_UP = Math.ceil((DAY * 365) / 12) + 1;
const RETAIL_SAME = Math.ceil(((DAY - 1) * 365) / 12) + 1;

test('the feed equal to FALLBACK → nothing changes (the committed site is in sync with itself)', () => {
  const root = copySite();
  const r = syncSite(root, offerFromFeed(feedWith({})), { write: true });
  assert.deepEqual(r.changed, []);
});

test('a promo-length publish rewrites FALLBACK, every chevron page and the structured data — and a second run changes nothing', () => {
  const root = copySite();
  const before = Object.fromEntries(PAGES.map((f) => [f, read(root, f)]));
  const next = offerFromFeed(feedWith({ promoMonths: MONTHS }));
  const r = syncSite(root, next, { write: true });
  assert.deepEqual(r.changed, ['electrical.html', 'general-contractor.html', 'handyman.html', 'hvac.html', 'index.html', 'plumbing.html', 'pricing.js']);
  assert.equal(fallbackOf(root).promoMonths, MONTHS);
  for (const k of KEYS) if (k !== 'promoMonths') assert.equal(fallbackOf(root)[k], committed[k], `${k} must not move`);
  for (const f of PAGES.filter((p) => p !== 'support/index.html')) {
    const html = read(root, f);
    assert.ok(html.includes(`for first <span class="js-pm">${MONTHS}</span> <span class="js-pm-unit">months</span>`), `${f}: promo length`);
    assert.ok(!html.includes(`<span class="js-pm">${committed.promoMonths}</span>`), `${f}: no ${committed.promoMonths}-month hook left`);
    assert.match(html, new RegExp(`aria-label="[^"]* per month for first ${MONTHS} months, then `), `${f}: aria-label`);
  }
  const P = require(join(root, 'pricing.js'));
  const ld = JSON.parse(read(root, 'index.html').match(LD_RE)[1]);
  assert.deepEqual(ld['@graph'].find((n) => n['@type'] === 'SoftwareApplication').offers, P.offerLd(P.FALLBACK));
  assert.match(JSON.stringify(ld), new RegExp(`for the first ${MONTHS} months`));
  // Only the hooks moved: the pages differ from before only where pricing.js writes.
  const strip = (s) => s
    .replace(/<span class="js-pm">\d+<\/span> <span class="js-pm-unit">months?<\/span>/g, 'PM')
    .replace(/aria-label="First [^"]*"/g, 'ARIA')
    .replace(LD_RE, 'LD');
  for (const f of PAGES) assert.equal(strip(read(root, f)), strip(before[f]), `${f}: something besides the hooks changed`);
  // Idempotent.
  assert.deepEqual(syncSite(root, next, { write: true }).changed, []);
});

test('a trial-length change reaches the chevron, the support FAQ answer and its structured data', () => {
  const root = copySite();
  const r = syncSite(root, offerFromFeed(feedWith({ trialDays: 21 })), { write: true });
  assert.ok(r.changed.includes('support/index.html'));
  const faq = read(root, 'support/index.html');
  assert.ok(faq.includes('Your first <span class="js-td">21</span> days are free.'));
  assert.ok(faq.includes('Your first 21 days are free.') && faq.includes('On day 21 your monthly subscription starts'), 'FAQ JSON-LD follows');
  assert.ok(!faq.includes('<span class="js-td">30</span>'));
  assert.ok(read(root, 'hvac.html').includes('<span class="js-td">21</span>'));
});

test('a page that drifted from what pricing.js renders STOPS the sync before anything is written', () => {
  const root = copySite();
  const hvac = read(root, 'hvac.html');
  writeFileSync(join(root, 'hvac.html'), hvac.replace(/<span class="mchev__amt">[^<]*<\/span>/, '<span class="mchev__amt">$49</span>'));
  const js = read(root, 'pricing.js');
  assert.throws(() => syncSite(root, offerFromFeed(feedWith({ promoMonths: MONTHS })), { write: true }), (e) => e instanceof SyncError && e.code === 1 && /hvac\.html .*promo price/.test(e.message));
  assert.equal(read(root, 'pricing.js'), js, 'pricing.js untouched');
  assert.ok(read(root, 'index.html').includes(`<span class="js-pm">${committed.promoMonths}</span>`), 'no page half-rewritten');
});

test('structured data that drifted from offerLd(FALLBACK) STOPS the sync too', () => {
  const root = copySite();
  const index = read(root, 'index.html');
  writeFileSync(join(root, 'index.html'), index.replace(/("offers": \{\s*"@type": "Offer",\s*"price": )\d+/, '$149'));
  assert.notEqual(read(root, 'index.html'), index, 'the fixture edit applied');
  const js = read(root, 'pricing.js');
  assert.throws(() => syncSite(root, offerFromFeed(feedWith({ promoMonths: MONTHS })), { write: true }), (e) => e instanceof SyncError && e.code === 1 && /JSON-LD offer/.test(e.message));
  assert.equal(read(root, 'pricing.js'), js, 'pricing.js untouched');
});

test('a checkout missing chevron pages is refused — a sync must never report "in sync" on a site it cannot see', async () => {
  const root = copySite();
  const { rmSync } = await import('node:fs');
  rmSync(join(root, 'hvac.html'));
  assert.throws(() => syncSite(root, offerFromFeed(feedWith({ promoMonths: MONTHS })), { write: true }), (e) => e instanceof SyncError && e.code === 1 && /six chevron pages, found 5/.test(e.message));
  assert.ok(read(root, 'index.html').includes(`<span class="js-pm">${committed.promoMonths}</span>`), 'nothing written');
});

test('a feed that is malformed changes nothing (exit 2): no solo, a non-number, a negative, a fractional month', () => {
  for (const body of [{}, { plans: {} }, feedWith({ promoMonths: 'three' }), feedWith({ retailPriceUsd: -1 }), feedWith({ promoMonths: 1.5 }), feedWith({ minutesIncluded: undefined })]) {
    assert.throws(() => offerFromFeed(body), (e) => e instanceof SyncError && e.code === 2);
  }
});

test('the CLI: check mode exits 3 and writes nothing; --write exits 0; a stopped sync exits with its code', () => {
  const root = copySite();
  const feedFile = join(root, 'feed.json');
  writeFileSync(feedFile, JSON.stringify(feedWith({ promoMonths: MONTHS })));
  const run = (...args) => {
    try {
      execFileSync(process.execPath, [join(SITE, 'tools/pricing-sync.mjs'), '--root', root, '--feed-file', feedFile, ...args], { stdio: 'pipe' });
      return 0;
    } catch (e) {
      return e.status;
    }
  };
  const js = read(root, 'pricing.js');
  assert.equal(run(), 3);
  assert.equal(read(root, 'pricing.js'), js, 'check mode wrote nothing');
  assert.equal(run('--write'), 0);
  assert.equal(fallbackOf(root).promoMonths, MONTHS);
  assert.equal(run(), 0, 'in sync now');
  writeFileSync(feedFile, '{"plans":{}}');
  assert.equal(run('--write'), 2);
});

// ── AFMBP-2720: the per-day figure ──────────────────────────────────────────────────────────────

test('AFMBP-2720: perDay is the standard price per day rounded UP to a whole dollar, one higher at an exact whole dollar', () => {
  const day = (retailPriceUsd) => perDay({ retailPriceUsd });
  assert.equal(day(79), 3, '$2.60 a day');
  assert.equal(day(73), 3, '$2.40 a day');
  assert.equal(day(91.25), 4, 'exactly $3.00 a day: "less than $3" would be false');
  assert.equal(day(60.83), 2, '$1.9999 a day');
  assert.equal(day(121.66), 4, '$3.9998 a day: the drawn "$4" still holds');
  assert.equal(day(121.67), 5, '$4.0001 a day: it no longer does');
  assert.equal(day(0), 1);
  // Every figure is a whole dollar amount strictly above the day rate, and the smallest such.
  for (let cents = 0; cents <= 50000; cents += 7) {
    const n = day(cents / 100);
    assert.ok(Number.isInteger(n) && n * 36500 > cents * 12 && (n - 1) * 36500 <= cents * 12, `${cents}¢ a month: ${n}`);
  }
});

test('AFMBP-2720: the committed site says perDay(FALLBACK) in every per-day line and its generated copies; the drawn cards keep "$4", still true', () => {
  for (const L of PER_DAY_LINES) assert.equal(count(read(SITE, L.file), L.line(DAY)), 1, `${L.file}: ${L.what} reads "${L.line(DAY)}" once`);
  const min = read(SITE, 'demo.min.js');
  assert.ok(min.includes(PER_DAY_TEXT.card(DAY)) && min.includes(PER_DAY_TEXT.success(DAY)), 'demo.min.js carries both demo lines');
  for (const f of START) assert.equal(count(read(SITE, f), PER_DAY_TEXT.card(DAY)), 1, `${f}: the card's pitch`);
  // Not the bot's (owner, 2026-11-24: "leave those at $4/day"): the drawn cards' screen-reader lines.
  assert.ok(read(SITE, 'demo.js').includes(`and more for less than $${DRAWN_PER_DAY} a day. (...without complaining)`), "the demo card's screen-reader line");
  assert.ok(read(SITE, 'tools/quick-landing-build.mjs').includes(`when you can’t for less than $${DRAWN_PER_DAY}/day.`), "the /start/ treatment card's screen-reader line");
  assert.ok(DAY <= DRAWN_PER_DAY, `perDay(FALLBACK) ${DAY} makes the drawn "less than $${DRAWN_PER_DAY} a day" untrue`);
});

test('AFMBP-2720: a standard price that moves the figure rewrites the four lines and nothing else in their files — and a second run changes nothing', () => {
  const root = copySite();
  const next = offerFromFeed(feedWith({ retailPriceUsd: RETAIL_UP }));
  assert.equal(perDay(next), DAY + 1, 'fixture: the figure moves up one');
  const before = Object.fromEntries(PER_DAY_FILES.map((f) => [f, read(root, f)]));
  const r = syncSite(root, next, { write: true });
  for (const f of PER_DAY_FILES) assert.ok(r.changed.includes(f), `${f} rewritten`);
  for (const L of PER_DAY_LINES) {
    const src = read(root, L.file);
    assert.equal(count(src, L.line(DAY + 1)), 1, `${L.file}: ${L.what} says $${DAY + 1}`);
    assert.equal(count(src, L.line(DAY)), 0, `${L.file}: ${L.what} keeps no $${DAY}`);
  }
  // Put the old figure back and every file is byte for byte what it was: only the figure moved.
  for (const f of PER_DAY_FILES) {
    let back = read(root, f);
    for (const L of PER_DAY_LINES.filter((l) => l.file === f)) back = back.split(L.line(DAY + 1)).join(L.line(DAY));
    assert.equal(back, before[f], `${f}: something besides the figure changed`);
  }
  assert.ok(read(root, 'demo.js').includes(`and more for less than $${DRAWN_PER_DAY} a day. (...without complaining)`), 'the drawn card keeps its line');
  assert.deepEqual(syncSite(root, next, { write: true }).changed, [], 'idempotent');
});

test('AFMBP-2720: a standard price in the same dollar band leaves the per-day files alone', () => {
  const root = copySite();
  assert.equal(perDay({ retailPriceUsd: RETAIL_SAME }), DAY, 'fixture: the figure stays');
  assert.notEqual(RETAIL_SAME, committed.retailPriceUsd, 'fixture: the price moves');
  const r = syncSite(root, offerFromFeed(feedWith({ retailPriceUsd: RETAIL_SAME })), { write: true });
  assert.ok(r.changed.includes('pricing.js'));
  for (const f of PER_DAY_FILES) assert.ok(!r.changed.includes(f), `${f} untouched`);
});

test('AFMBP-2720: a per-day line that drifted STOPS the sync before anything is written, with or without a price change', () => {
  const root = copySite();
  writeFileSync(join(root, 'demo.js'), read(root, 'demo.js').replace(PER_DAY_TEXT.success(DAY), PER_DAY_TEXT.success(DAY + 5)));
  const js = read(root, 'pricing.js');
  const about = read(root, 'about/index.html');
  const stopped = (e) => e instanceof SyncError && e.code === 1 && /demo\.js: the demo's success screen no longer reads/.test(e.message);
  assert.throws(() => syncSite(root, offerFromFeed(feedWith({ retailPriceUsd: RETAIL_UP })), { write: true }), stopped);
  assert.equal(read(root, 'pricing.js'), js, 'pricing.js untouched');
  assert.equal(read(root, 'about/index.html'), about, 'no per-day line half-rewritten');
  assert.throws(() => syncSite(root, offerFromFeed(feedWith({})), { write: true }), stopped, 'caught on the next run even with no publish');
});

test('AFMBP-2720: --check-drawn passes at the committed price and fails from $121.67 a month, where "less than $4 a day" is untrue', () => {
  const root = copySite();
  const run = () => {
    try {
      execFileSync(process.execPath, [join(SITE, 'tools/pricing-sync.mjs'), '--root', root, '--check-drawn'], { stdio: 'pipe' });
      return 0;
    } catch (e) {
      return e.status;
    }
  };
  const js = read(root, 'pricing.js');
  const withRetail = (retailPriceUsd) => writeFileSync(join(root, 'pricing.js'), js.replace(/var FALLBACK = \{[\s\S]*?\};/, fallbackBlock({ ...committed, retailPriceUsd })));
  assert.equal(run(), 0, 'the committed price');
  withRetail(121.67);
  assert.equal(run(), 1, '$121.67 a month is $4.0001 a day');
  withRetail(121.66);
  assert.equal(run(), 0, '$121.66 a month is $3.9998 a day');
});
