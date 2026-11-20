#!/usr/bin/env node
/*
 * AFMBP-2664 — rebuild the website's pricing fallback from the published price.
 *
 * Before pricing.js reaches GET /api/public/pricing (and for readers and
 * crawlers that never run it), the site shows the price four ways:
 *   1. pricing.js FALLBACK — applied first on every page load;
 *   2. the chevron values baked into the six pricing pages;
 *   3. the homepage's structured data (JSON-LD) offer;
 *   4. the trial length in the support page's FAQ (its text and its JSON-LD).
 * They were edited by hand after each publish in /admin/pricing, so every
 * publish left them stale until someone did. This regenerates all four from
 * the feed, using pricing.js's OWN renderer (apply(), offerLd()), so what it
 * bakes is exactly what pricing.test.mjs pins and what the page shows once the
 * script runs.
 *
 * SAFE BY CONSTRUCTION
 *   - It rewrites only what pricing.js itself rewrites at runtime — the hooks
 *     (.mchev__amt, .js-pm, .js-pm-unit, .js-pm-verb, .js-td, .js-retail, the
 *     fine print, the chevron's aria-label) and the structured data. Never any
 *     other copy.
 *   - It renders the CURRENT fallback first and requires every chevron page to
 *     carry that render. A page that no longer matches what pricing.js renders
 *     stops the sync before anything is written (exit 1): fix the page, don't
 *     guess.
 *   - A feed that is unreachable or malformed writes nothing (exit 2).
 *   - Running it twice changes nothing the second time.
 *
 * USAGE
 *   node tools/pricing-sync.mjs                 check only: exit 0 in sync, 3 = would change
 *   node tools/pricing-sync.mjs --write         rewrite the files (exit 0)
 *   --root <dir>                                the site checkout (default: this repo)
 *   --feed-file <path>                          read the feed from a file instead of the URL (tests)
 *
 * The pricing-sync workflow runs it after every publish (dispatched by the
 * backend) and every 15 minutes, then runs pricing.test.mjs and commits.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FEED_URL = 'https://bolt-staging.fly.dev/api/public/pricing';
export const KEYS = ['promoPriceUsd', 'retailPriceUsd', 'promoMonths', 'trialDays', 'perMinuteUsd', 'perMessageUsd', 'minutesIncluded', 'messagesIncluded'];
const WHOLE = new Set(['promoMonths', 'trialDays', 'minutesIncluded', 'messagesIncluded']);
const LD_OFFER = /(<script type="application\/ld\+json" class="js-ld-offer">)([\s\S]*?)(<\/script>)/;
const LD_FAQ = /(<script type="application\/ld\+json" class="js-ld-faq">)([\s\S]*?)(<\/script>)/;
const FALLBACK_BLOCK = /var FALLBACK = \{[\s\S]*?\};/;

export class SyncError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** The feed's Solo plan → the eight numbers the site renders. Throws SyncError(2) on anything unusable. */
export function offerFromFeed(body) {
  const solo = body && body.plans && body.plans.solo;
  if (!solo || typeof solo !== 'object') throw new SyncError('the feed has no plans.solo', 2);
  const out = {};
  for (const k of KEYS) {
    const v = solo[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new SyncError(`the feed's plans.solo.${k} is not a non-negative number (${JSON.stringify(v)})`, 2);
    if (WHOLE.has(k) && !Number.isInteger(v)) throw new SyncError(`the feed's plans.solo.${k} is not a whole number (${v})`, 2);
    out[k] = v;
  }
  return out;
}

/** What pricing.js writes into each hook for these numbers — the same stand-in DOM pricing.test.mjs uses. */
export function render(P, p) {
  const el = () => ({ textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const li = [el(), el()];
  const nodes = {
    '.mchev__amt': [el()],
    '.js-pm': [el()],
    '.js-pm-unit': [el()],
    '.js-pm-verb': [el()],
    '.js-td': [el()],
    '.js-retail': [el()],
    '.mchev__fine': [{ querySelectorAll: () => li }],
    '.chev-mobile': [el()],
  };
  P.apply({ readyState: 'complete', querySelectorAll: (sel) => nodes[sel] || [] }, p);
  const t = (sel) => String(nodes[sel][0].textContent);
  return {
    amt: t('.mchev__amt'),
    pm: t('.js-pm'),
    pmUnit: t('.js-pm-unit'),
    pmVerb: t('.js-pm-verb'),
    td: t('.js-td'),
    retail: t('.js-retail'),
    fine0: String(li[0].textContent),
    fine1: String(li[1].textContent),
    aria: String(nodes['.chev-mobile'][0].attrs['aria-label']),
  };
}

/** The baked strings for one render. `need` = every chevron page must carry it. */
function hooks(r) {
  return [
    { name: 'promo price', s: `<span class="mchev__amt">${r.amt}</span>`, need: true },
    { name: 'promo length', s: `<span class="js-pm">${r.pm}</span> <span class="js-pm-unit">${r.pmUnit}</span>`, need: true },
    { name: 'promo verb', s: `<span class="js-pm-verb">${r.pmVerb}</span>`, need: false },
    { name: 'trial length', s: `<span class="js-td">${r.td}</span>`, need: true },
    { name: 'retail price', s: `<span class="js-retail">${r.retail}</span>`, need: false },
    { name: 'fine print (standard price)', s: `<li>${r.fine0}</li>`, need: true },
    { name: 'fine print (allowances)', s: `<li>${r.fine1}</li>`, need: true },
    { name: 'aria-label', s: `aria-label="${r.aria}"`, need: true },
  ];
}

/** The fallback block in pricing.js, in its committed format. */
export function fallbackBlock(p) {
  return 'var FALLBACK = {\n' + KEYS.map((k, i) => `    ${k}: ${p[k]}${i < KEYS.length - 1 ? ',' : ''}`).join('\n') + '\n  };';
}

/** The offer object as it is baked in the homepage's JSON-LD: two-space JSON, continuation lines indented like `"offers"`. */
function bakedOffer(P, p, indent) {
  return '"offers": ' + JSON.stringify(P.offerLd(p), null, 2).split('\n').map((l, i) => (i ? indent + l : l)).join('\n');
}

const replaceAll = (s, from, to) => s.split(from).join(to);
const count = (s, sub) => s.split(sub).length - 1;

function htmlFiles(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'vendor' || name === 'assets') continue;
    const p = join(dir, name);
    // blog/ is the blog bot's: it shows no prices and its pages are rebuilt from WordPress.
    if (dir === root && name === 'blog') continue;
    if (statSync(p).isDirectory()) htmlFiles(root, p, out);
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

function loadPricing(root) {
  const require = createRequire(import.meta.url);
  const path = join(root, 'pricing.js');
  delete require.cache[require.resolve(path)];
  return require(path);
}

/**
 * Plan (and with write=true, apply) the rewrite for `next`. Returns the files
 * that change. Throws SyncError(1) when a page has drifted from what pricing.js
 * renders — before anything is written.
 */
export function syncSite(root, next, { write = false } = {}) {
  const P = loadPricing(root);
  const prev = {};
  for (const k of KEYS) prev[k] = P.FALLBACK[k];
  const same = KEYS.every((k) => prev[k] === next[k]);
  const changes = new Map(); // path -> new content

  const before = render(P, prev);
  const after = render(P, next);
  const pairs = hooks(before).map((h, i) => ({ ...h, to: hooks(after)[i].s })).filter((h) => h.s !== h.to);

  const pages = htmlFiles(root);
  const chevronPages = pages.filter((f) => readFileSync(f, 'utf8').includes('class="mchev__amt"'));
  if (chevronPages.length < 6) throw new SyncError(`expected the six chevron pages, found ${chevronPages.length} — refusing to sync a site it cannot see`, 1);
  for (const f of chevronPages) {
    const html = readFileSync(f, 'utf8');
    const missing = hooks(before).filter((h) => h.need && !html.includes(h.s)).map((h) => h.name);
    if (missing.length) {
      throw new SyncError(`${relative(root, f)} no longer carries what pricing.js renders for the current FALLBACK (${missing.join(', ')}) — fix the page, then re-run`, 1);
    }
  }

  for (const f of pages) {
    let html = readFileSync(f, 'utf8');
    const orig = html;
    for (const h of pairs) html = replaceAll(html, h.s, h.to);

    // The homepage's structured data: the offer node, re-rendered like pricing.js does at runtime.
    const ld = html.match(LD_OFFER);
    if (ld) {
      const line = ld[2].split('\n').find((l) => /"offers": \{/.test(l));
      const indent = line ? line.match(/^\s*/)[0] : '';
      const was = bakedOffer(P, prev, indent);
      if (!ld[2].includes(was)) throw new SyncError(`${relative(root, f)}: the JSON-LD offer is not offerLd(FALLBACK) — fix it, then re-run`, 1);
      html = html.replace(LD_OFFER, (_m, a, body, c) => a + body.replace(was, () => bakedOffer(P, next, indent)) + c);
    }

    // The support FAQ's structured data repeats the trial length the visible answer takes from .js-td.
    const faq = html.match(LD_FAQ);
    if (faq && before.td !== after.td) {
      const phrases = [
        [`Your first ${before.td} days are free.`, `Your first ${after.td} days are free.`],
        [`On day ${before.td} your monthly subscription starts`, `On day ${after.td} your monthly subscription starts`],
      ];
      let body = faq[2];
      for (const [from, to] of phrases) {
        if (count(body, from) !== 1) throw new SyncError(`${relative(root, f)}: the FAQ JSON-LD no longer says "${from}" exactly once — fix it, then re-run`, 1);
        body = replaceAll(body, from, to);
      }
      html = html.replace(LD_FAQ, (_m, a, _b, c) => a + body + c);
    }

    if (html !== orig) changes.set(f, html);
  }

  const js = readFileSync(join(root, 'pricing.js'), 'utf8');
  if (!FALLBACK_BLOCK.test(js)) throw new SyncError('pricing.js has no FALLBACK block', 1);
  const nextJs = js.replace(FALLBACK_BLOCK, () => fallbackBlock(next));
  if (nextJs !== js) changes.set(join(root, 'pricing.js'), nextJs);

  if (same && changes.size) throw new SyncError('the feed equals FALLBACK but the pages would still change — a page drifted', 1);

  if (write) for (const [f, content] of changes) writeFileSync(f, content);
  return { changed: [...changes.keys()].map((f) => relative(root, f)).sort(), prev, next };
}

async function readFeed(feedFile) {
  if (feedFile) return JSON.parse(readFileSync(feedFile, 'utf8'));
  let res;
  try {
    res = await fetch(FEED_URL, { headers: { Accept: 'application/json', 'User-Agent': 'bolt-site-pricing-sync' }, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new SyncError(`could not reach ${FEED_URL}: ${err && err.message ? err.message : err}`, 2);
  }
  if (!res.ok) throw new SyncError(`${FEED_URL} answered ${res.status}`, 2);
  try {
    return await res.json();
  } catch {
    throw new SyncError(`${FEED_URL} did not answer JSON`, 2);
  }
}

async function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const write = argv.includes('--write');
  const root = arg('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..');
  const next = offerFromFeed(await readFeed(arg('--feed-file')));
  const r = syncSite(root, next, { write });
  const diff = KEYS.filter((k) => r.prev[k] !== r.next[k]).map((k) => `${k} ${r.prev[k]}→${r.next[k]}`);
  if (!r.changed.length) {
    console.log('[pricing-sync] in sync with the published price — nothing to change.');
    return 0;
  }
  console.log(`[pricing-sync] ${write ? 'rewrote' : 'would rewrite'} ${r.changed.length} file(s) for ${diff.join(', ')}:\n  ${r.changed.join('\n  ')}`);
  return write ? 0 : 3;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[pricing-sync] ${err instanceof SyncError ? 'STOPPED' : 'FAILED'}: ${err && err.message ? err.message : err}`);
      process.exit(err instanceof SyncError ? err.code : 1);
    },
  );
}
