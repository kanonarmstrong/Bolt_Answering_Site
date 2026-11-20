/* AFMBP-2664 — tools/pricing-sync.mjs rebuilds the site's pricing fallback from the published price.
   Run: node --test tools/pricing-sync.test.mjs
   Every test works on a throwaway copy of the pages pricing.js touches, never on the checkout. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { offerFromFeed, syncSite, SyncError, KEYS } from './pricing-sync.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['index.html', 'hvac.html', 'plumbing.html', 'electrical.html', 'handyman.html', 'general-contractor.html', 'support/index.html'];
const require = createRequire(import.meta.url);

function copySite() {
  const root = mkdtempSync(join(tmpdir(), 'pricing-sync-'));
  mkdirSync(join(root, 'support'));
  for (const f of ['pricing.js', ...PAGES]) cpSync(join(SITE, f), join(root, f));
  return root;
}
const read = (root, f) => readFileSync(join(root, f), 'utf8');
const fallbackOf = (root) => {
  const p = join(root, 'pricing.js');
  delete require.cache[require.resolve(p)];
  return require(p).FALLBACK;
};
const committed = fallbackOf(SITE);
const feedWith = (over) => ({ plans: { solo: { plan: 'solo', displayName: 'Solo', ...committed, ...over }, crew: {} }, versions: { solo: 'v', crew: null } });
const LD_RE = /<script type="application\/ld\+json" class="js-ld-offer">([\s\S]*?)<\/script>/;

test('the feed equal to FALLBACK → nothing changes (the committed site is in sync with itself)', () => {
  const root = copySite();
  const r = syncSite(root, offerFromFeed(feedWith({})), { write: true });
  assert.deepEqual(r.changed, []);
});

test('a 3-month publish rewrites FALLBACK, every chevron page and the structured data — and a second run changes nothing', () => {
  const root = copySite();
  const before = Object.fromEntries(PAGES.map((f) => [f, read(root, f)]));
  const next = offerFromFeed(feedWith({ promoMonths: 3 }));
  const r = syncSite(root, next, { write: true });
  assert.deepEqual(r.changed, ['electrical.html', 'general-contractor.html', 'handyman.html', 'hvac.html', 'index.html', 'plumbing.html', 'pricing.js']);
  assert.equal(fallbackOf(root).promoMonths, 3);
  for (const k of KEYS) if (k !== 'promoMonths') assert.equal(fallbackOf(root)[k], committed[k], `${k} must not move`);
  for (const f of PAGES.filter((p) => p !== 'support/index.html')) {
    const html = read(root, f);
    assert.ok(html.includes('for first <span class="js-pm">3</span> <span class="js-pm-unit">months</span>'), `${f}: promo length`);
    assert.ok(!html.includes('<span class="js-pm">1</span>'), `${f}: no 1-month hook left`);
    assert.match(html, /aria-label="[^"]* per month for first 3 months, then /, `${f}: aria-label`);
  }
  const P = require(join(root, 'pricing.js'));
  const ld = JSON.parse(read(root, 'index.html').match(LD_RE)[1]);
  assert.deepEqual(ld['@graph'].find((n) => n['@type'] === 'SoftwareApplication').offers, P.offerLd(P.FALLBACK));
  assert.match(JSON.stringify(ld), /for the first 3 months/);
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
  assert.throws(() => syncSite(root, offerFromFeed(feedWith({ promoMonths: 3 })), { write: true }), (e) => e instanceof SyncError && e.code === 1 && /hvac\.html .*promo price/.test(e.message));
  assert.equal(read(root, 'pricing.js'), js, 'pricing.js untouched');
  assert.ok(read(root, 'index.html').includes('<span class="js-pm">1</span>'), 'no page half-rewritten');
});

test('a feed that is malformed changes nothing (exit 2): no solo, a non-number, a negative, a fractional month', () => {
  for (const body of [{}, { plans: {} }, feedWith({ promoMonths: 'three' }), feedWith({ retailPriceUsd: -1 }), feedWith({ promoMonths: 1.5 }), feedWith({ minutesIncluded: undefined })]) {
    assert.throws(() => offerFromFeed(body), (e) => e instanceof SyncError && e.code === 2);
  }
});

test('the CLI: check mode exits 3 and writes nothing; --write exits 0; a stopped sync exits with its code', () => {
  const root = copySite();
  const feedFile = join(root, 'feed.json');
  writeFileSync(feedFile, JSON.stringify(feedWith({ promoMonths: 3 })));
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
  assert.equal(fallbackOf(root).promoMonths, 3);
  assert.equal(run(), 0, 'in sync now');
  writeFileSync(feedFile, '{"plans":{}}');
  assert.equal(run('--write'), 2);
});
