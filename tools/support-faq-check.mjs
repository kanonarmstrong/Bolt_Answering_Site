// AFMBP-2535 — the support page's FAQ answers the brand questions in the owner's own words, and its FAQPage
// JSON-LD is the FAQ exactly as shown. This proves, for support/index.html (or the live page):
//   - "What is Bolt Answering?", "Who is it for?" and "Is Bolt Answering the same as other companies called
//     'Bolt'?" are in the FAQ, each once, with the owner's answers word for word;
//   - the pricing question is there once (the brief's "how much / free trial" question is not duplicated);
//   - no other company is named on the page;
//   - one FAQPage JSON-LD block whose questions and answers equal the FAQ as shown, in order (the pricing
//     answer at pricing.js's FALLBACK numbers; pricing.js rebuilds the JSON-LD from the page in the browser).
// Run: node tools/support-faq-check.mjs [siteRoot]      BASE=https://www.boltanswering.com runs it on the live page.
//      NC=answer|missing|dupe|stale|rival   negative controls on the copy read; each must FAIL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const BASE = (process.env.BASE || '').replace(/\/+$/, '');
const NC = process.env.NC || '';
const OWNER = [
  ['What is Bolt Answering?', 'Bolt Answering is an AI phone answering service for solo tradespeople. It answers every call, books jobs and follows up.'],
  ['Who is it for?', 'Solo independent pros and small crews in HVAC, plumbing, electrical, general contracting, and handyman work. That includes people building a business on the side of a full-time job, and owners whose spouse or a friend used to cover the phone.'],
  ['Is Bolt Answering the same as other companies called ‘Bolt’?', 'No. Bolt Answering is an independent product at boltanswering.com and isn’t affiliated with other companies that use the name Bolt.'],
];
const PRICING_Q = 'How much does it cost, and are there contracts, hidden fees, or a catch?';

let html = BASE
  ? await (await fetch(`${BASE}/support/?cb=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } })).text()
  : readFileSync(join(ROOT, 'support/index.html'), 'utf8');

const swap = (a, b) => { assert.ok(html.includes(a), `NC=${NC}: anchor missing`); const t = html.replace(a, b); assert.notEqual(t, html); html = t; };
if (NC === 'answer') swap('isn&rsquo;t affiliated with other companies that use the name Bolt.', 'isn&rsquo;t affiliated with any other company.');
if (NC === 'missing') html = html.replace(/<details class="sup-faq__item">\s*<summary>What is Bolt Answering\?[\s\S]*?<\/details>/, '');
if (NC === 'dupe') swap('<details class="sup-faq__item">\n            <summary>How much does it cost', '<details class="sup-faq__item"><summary>How much does it cost, and are there contracts, hidden fees, or a catch?</summary><div class="sup-faq__a"><p>x</p></div></details>\n          <details class="sup-faq__item">\n            <summary>How much does it cost');
if (NC === 'stale') swap('Bolt always tells your caller it&rsquo;s a smart assistant, right up front.', 'Bolt tells your caller it&rsquo;s a smart assistant.');
if (NC === 'rival') swap('</main>', '<p>Not BOLT Systems.</p></main>');

const decode = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–', hellip: '…', rarr: '→', copy: '©', middot: '·' };
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return named[e.toLowerCase()] ?? m;
});
const shown = (frag) => decode(frag.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const faqStart = html.indexOf('<div class="sup-faq">');
const items = [...html.slice(faqStart).matchAll(/<details class="sup-faq__item">\s*<summary>([\s\S]*?)<\/summary>\s*<div class="sup-faq__a">([\s\S]*?)<\/div>\s*<\/details>/g)]
  .map((m) => [shown(m[1]), shown(m[2])]);

let n = 0; const fails = [];
const check = (label, fn) => { n++; try { fn(); } catch (e) { fails.push(`${label}: ${e.message.split('\n')[0]}`); } };

check('the page has its FAQ', () => assert.ok(faqStart > 0 && items.length >= 14, `${items.length} items`));
for (const [q, a] of OWNER) {
  check(`"${q}" is in the FAQ once, with the owner's answer`, () => {
    const hits = items.filter(([iq]) => iq === q);
    assert.equal(hits.length, 1, `${hits.length} times`);
    assert.equal(hits[0][1], a);
  });
}
check('the pricing question is there once (not duplicated)', () => assert.equal(items.filter(([q]) => q === PRICING_Q).length, 1));
check('no other company is named on the page', () => assert.ok(!/bolt\s*systems|boltsystems/i.test(html)));
const ld = [...html.matchAll(/<script type="application\/ld\+json" class="js-ld-faq">([\s\S]*?)<\/script>/g)];
check('one FAQPage JSON-LD block', () => assert.equal(ld.length, 1));
check('the FAQPage JSON-LD is the FAQ exactly as shown, in order', () => {
  const d = JSON.parse(ld[0][1]);
  assert.equal(d['@type'], 'FAQPage');
  assert.deepEqual(d.mainEntity.map((x) => [x.name, x.acceptedAnswer.text]), items);
  assert.ok(d.mainEntity.every((x) => x['@type'] === 'Question' && x.acceptedAnswer['@type'] === 'Answer'));
});
check('pricing.js rebuilds it in the browser', () => {
  const pricing = BASE ? null : readFileSync(join(ROOT, 'pricing.js'), 'utf8');
  if (pricing) assert.ok(pricing.includes("each(doc, 'script.js-ld-faq'"));
  assert.ok(/<script src="\/pricing\.js\?v=\d+"><\/script>/.test(html), 'the page loads pricing.js');
});

console.log(`${n} checks, ${fails.length} failed${NC ? ` (NC=${NC})` : ''}${BASE ? ` on ${BASE}` : ''}`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
