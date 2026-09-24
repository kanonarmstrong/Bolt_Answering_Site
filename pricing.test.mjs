/* AFMBP-1903 — the site follows the pricing feed for everything it shows about
   the offer: prices, the promo LENGTH, the trial length, the allowances.
   Run: node --test pricing.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const P = require('./pricing.js');

/* A tiny stand-in for the chevron's DOM: just the hooks pricing.js writes. */
function fakeDoc() {
  const el = (text) => ({ textContent: text, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const li = [el('After promo period, price increases to $0 / month'), el('Includes 750 messages …')];
  const nodes = {
    '.mchev__amt': [el('$0')],
    '.js-pm': [el('3')],
    '.js-td': [el('30')],
    '.js-cta-trial': [el('Start my free 30-day trial'), el('Start my free 30-day trial')],
    '.mchev__fine': [{ querySelectorAll: () => li }],
    '.chev-mobile': [el('')],
  };
  return { readyState: 'complete', li, nodes, querySelectorAll: (sel) => nodes[sel] || [] };
}
const text = (doc, sel, i = 0) => doc.nodes[sel][i].textContent;

const FEED = {
  promoPriceUsd: 39.99, retailPriceUsd: 59.99, promoMonths: 6, trialDays: 14,
  perMinuteUsd: 0.12, perMessageUsd: 0.01, minutesIncluded: 500, messagesIncluded: 900,
};

test('the feed reaches every hook: price, promo LENGTH, trial, allowances, aria', () => {
  const doc = fakeDoc();
  P.apply(doc, FEED);
  assert.equal(text(doc, '.mchev__amt'), '$39.99');
  assert.equal(String(text(doc, '.js-pm')), '6');
  assert.equal(String(text(doc, '.js-td')), '14');
  assert.equal(text(doc, '.js-cta-trial', 1), 'Start my free 14-day trial');
  assert.equal(doc.li[0].textContent, 'After promo period, price increases to $59.99 / month');
  assert.equal(
    doc.li[1].textContent,
    'Includes 900 messages and 500 minutes per cycle, and only $0.12 / minute and $0.01/message beyond budget',
  );
  const aria = doc.nodes['.chev-mobile'][0].attrs['aria-label'];
  assert.match(aria, /^First 14-Day Trial FREE — /);
  assert.match(aria, /New Bolt Pro Pricing: \$39\.99 per month for first 6 months, then \$59\.99\/month; 900 messages and 500 minutes per cycle;/);
});

test('the fallback is the baked HTML (idempotent): 3 months, 30 days, 750 / 400', () => {
  const doc = fakeDoc();
  P.apply(doc, P.FALLBACK);
  assert.equal(String(text(doc, '.js-pm')), '3');
  assert.equal(String(text(doc, '.js-td')), '30');
  assert.equal(
    doc.li[1].textContent,
    'Includes 750 messages and 400 minutes per cycle, and only $0.12 / minute and $0.01/message beyond budget',
  );
});

test('0 is a real value — a 0-day trial is never shown as the 30-day fallback', () => {
  const doc = fakeDoc();
  P.apply(doc, { ...FEED, trialDays: 0 });
  assert.equal(String(text(doc, '.js-td')), '0');
});

test('an older feed without allowances keeps the fallback allowances', () => {
  const doc = fakeDoc();
  const { minutesIncluded, messagesIncluded, ...old } = FEED;
  P.apply(doc, old);
  assert.match(doc.li[1].textContent, /^Includes 750 messages and 400 minutes/);
});

test('feed down: the fallback stays and nothing throws', async () => {
  const doc = fakeDoc();
  await P.run(doc, () => Promise.reject(new Error('offline')));
  assert.equal(String(text(doc, '.js-pm')), '3');
  assert.equal(text(doc, '.mchev__amt'), '$0');
});

test('feed up: run() applies plans.solo from GET /api/public/pricing', async () => {
  const doc = fakeDoc();
  let asked;
  await P.run(doc, (url) => {
    asked = url;
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ plans: { solo: FEED } }) });
  });
  assert.equal(asked, 'https://bolt-staging.fly.dev/api/public/pricing');
  assert.equal(String(text(doc, '.js-pm')), '6');
});

/* ---- the pages themselves: every surface that shows the offer is wired ---- */
function htmlFiles(dir = '.') {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'assets') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

test('every visible "for first N months" is the .js-pm hook, never a baked number', () => {
  const pages = htmlFiles().filter((f) => readFileSync(f, 'utf8').includes('mchev__price'));
  assert.ok(pages.length >= 6, `found ${pages.length} chevron pages`);
  for (const f of pages) {
    const line = readFileSync(f, 'utf8').split('\n').find((l) => l.includes('class="mchev__price"'));
    assert.match(line, /for first <span class="js-pm">\d+<\/span> months/, f);
  }
});

test('every page with a trial CTA loads pricing.js, so the trial length follows the feed', () => {
  const pages = htmlFiles().filter((f) => readFileSync(f, 'utf8').includes('js-cta-trial'));
  assert.ok(pages.length >= 10, `found ${pages.length} CTA pages`);
  for (const f of pages) assert.match(readFileSync(f, 'utf8'), /<script src="\/?pricing\.js\?v=\d+"><\/script>/, f);
});
