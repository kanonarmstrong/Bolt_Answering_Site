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
  const li = [el('After promo period, price increases to $79 / month'), el('Includes 750 messages …')];
  const nodes = {
    '.mchev__amt': [el('$59')],
    '.js-pm': [el('1')],
    '.js-pm-unit': [el('month')],
    '.js-pm-verb': [el('is')],
    '.js-td': [el('30')],
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
  assert.equal(doc.li[0].textContent, 'After promo period, price increases to $59.99 / month');
  assert.equal(
    doc.li[1].textContent,
    'Includes 900 messages and 500 minutes per cycle, and only $0.12 / minute and $0.01/message beyond budget',
  );
  const aria = doc.nodes['.chev-mobile'][0].attrs['aria-label'];
  assert.match(aria, /^First 14-Day Trial FREE — /);
  assert.match(aria, /New Bolt Pro Pricing: \$39\.99 per month for first 6 months, then \$59\.99\/month; 900 messages and 500 minutes per cycle;/);
});

test('the fallback is the baked HTML (idempotent): 1 month, 30 days, 750 / 400', () => {
  const doc = fakeDoc();
  P.apply(doc, P.FALLBACK);
  assert.equal(String(text(doc, '.js-pm')), '1');
  assert.equal(text(doc, '.js-pm-unit'), 'month');
  assert.equal(text(doc, '.js-pm-verb'), 'is');
  assert.equal(String(text(doc, '.js-td')), '30');
  assert.equal(
    doc.li[1].textContent,
    'Includes 750 messages and 400 minutes per cycle, and only $0.12 / minute and $0.01/message beyond budget',
  );
});

test('every pricing page bakes the FALLBACK prices (AFMBP-1935): no-JS shows what pricing.js renders', () => {
  const doc = fakeDoc();
  P.apply(doc, P.FALLBACK);
  const promo = text(doc, '.mchev__amt');
  const fine = doc.li[0].textContent;
  const aria = doc.nodes['.chev-mobile'][0].attrs['aria-label'];
  const pages = readdirSync('.').filter((f) => f.endsWith('.html') && readFileSync(f, 'utf8').includes('mchev__amt'));
  assert.ok(pages.length >= 6, `expected the six pricing pages, found ${pages.length}`);
  for (const f of pages) {
    const html = readFileSync(f, 'utf8');
    assert.ok(html.includes(`<span class="mchev__amt">${promo}</span>`), `${f}: chevron amount is not the fallback ${promo}`);
    assert.ok(html.includes(`<li>${fine}</li>`), `${f}: fine print is not "${fine}"`);
    assert.ok(html.includes(`aria-label="${aria}"`), `${f}: aria-label differs from the fallback render`);
  }
});

test('AFMBP-1938: a 1-month promo reads "1 month … is"; any other length reads "N months … are"', () => {
  assert.equal(P.monthsWord(1), 'month');
  assert.equal(P.monthsWord(3), 'months');
  const one = fakeDoc();
  P.apply(one, { ...FEED, promoMonths: 1 });
  assert.equal(text(one, '.js-pm-unit'), 'month');
  assert.equal(text(one, '.js-pm-verb'), 'is');
  assert.match(one.nodes['.chev-mobile'][0].attrs['aria-label'], / per month for first 1 month, then /);
  const six = fakeDoc();
  P.apply(six, FEED); // 6 months
  assert.equal(text(six, '.js-pm-unit'), 'months');
  assert.equal(text(six, '.js-pm-verb'), 'are');
  assert.match(six.nodes['.chev-mobile'][0].attrs['aria-label'], / per month for first 6 months, then /);
});

test('AFMBP-1938: every page bakes the FALLBACK promo length with the agreeing unit', () => {
  const doc = fakeDoc();
  P.apply(doc, P.FALLBACK);
  const period = `<span class="js-pm">${text(doc, '.js-pm')}</span> <span class="js-pm-unit">${text(doc, '.js-pm-unit')}</span>`;
  const pages = readdirSync('.').filter((f) => f.endsWith('.html') && readFileSync(f, 'utf8').includes('mchev__amt'));
  for (const f of pages) assert.ok(readFileSync(f, 'utf8').includes(period), `${f}: promo length is not "${period}"`);
});

test('AFMBP-2580: the support FAQ cost answer is the owner\'s text (11-12), its trial length from the feed hook', () => {
  const doc = fakeDoc();
  P.apply(doc, P.FALLBACK);
  const td = `<span class="js-td">${text(doc, '.js-td')}</span>`;
  const faq = readFileSync('support/index.html', 'utf8');
  const want = `<p>Your first ${td} days are free. To start, you verify a card. Bolt places a temporary $1 hold that&rsquo;s returned automatically, and your card isn&rsquo;t charged during the trial. On day ${td} your monthly subscription starts automatically. It&rsquo;s month to month, with no annual contract. See <a href="https://www.boltanswering.com/#pricing">current pricing</a>.</p>`;
  assert.ok(faq.includes(`<div class="sup-faq__a">\n              ${want}\n            </div>`), 'support FAQ: the cost answer is not the owner\'s one paragraph');
  assert.ok(!/discounted|js-pm/.test(faq), 'support FAQ: no promo-period sentence left');
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
  assert.equal(String(text(doc, '.js-pm')), '1');
  assert.equal(text(doc, '.js-pm-unit'), 'month');
  // AFMBP-1935: feed down shows the published Solo price, never $0.
  assert.equal(text(doc, '.mchev__amt'), '$59');
  assert.equal(doc.li[0].textContent, 'After promo period, price increases to $79 / month');
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
    // AFMBP-1938: the unit is a hook too, so "1 month" / "3 months" follow the feed.
    assert.match(line, /for first <span class="js-pm">\d+<\/span> <span class="js-pm-unit">months?<\/span>/, f);
  }
});

test('AFMBP-2548: every trial button reads "Start your free trial" (owner, 2026-11-10; before: AFMBP-2537, AFMBP-2482), and pricing.js writes no trial length into one', () => {
  const buttons = [];
  // blog/ is the bot's: its pages copy the nav and floating button from the site at its next build.
  for (const f of htmlFiles().filter((f) => !f.startsWith('blog/'))) {
    const html = readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<a href="https:\/\/app\.boltanswering\.com\/signup" class="btn btn--yellow[^"]*">([\s\S]*?)<\/a>/g)) buttons.push([f, m[1].trim()]);
    assert.ok(!/Start my free|free 30-day trial/i.test(html), `${f} still has an old trial label`);
  }
  assert.ok(buttons.length >= 22, `found ${buttons.length} trial buttons`);
  for (const [f, label] of buttons) assert.equal(label, 'Start your free trial', f);
  const src = readFileSync(new URL('./pricing.js', import.meta.url), 'utf8');
  assert.ok(!/js-cta-trial|Start my free/.test(src), 'pricing.js still rewrites a trial button');
});

test('AFMBP-2273: the retail price in running text (.js-retail) follows the feed, and falls back', () => {
  const el = { textContent: '$79' };
  const doc = { readyState: 'complete', querySelectorAll: (sel) => (sel === '.js-retail' ? [el] : []) };
  P.apply(doc, FEED);
  assert.equal(el.textContent, '$59.99');
  P.apply(doc, P.FALLBACK);
  assert.equal(el.textContent, '$79');
});

test('AFMBP-2273: reapply writes the LAST numbers applied into hooks added since (the offer card)', () => {
  const nodes = {};
  const doc = { readyState: 'complete', querySelectorAll: (sel) => nodes[sel] || [] };
  P.apply(doc, FEED); // the feed answered before the card existed
  nodes['.js-td'] = [{ textContent: '30' }];
  nodes['.js-retail'] = [{ textContent: '$79' }];
  P.reapply(doc); // the card asks once its hooks are in the page
  assert.equal(String(nodes['.js-td'][0].textContent), '14');
  assert.equal(nodes['.js-retail'][0].textContent, '$59.99');
});

/* AFMBP-2525 — the homepage's structured data (JSON-LD) states the offer the chevron shows. */
const LD_RE = /<script type="application\/ld\+json" class="js-ld-offer">([\s\S]*?)<\/script>/;
const appNode = (ld) => ld['@graph'].find((n) => n['@type'] === 'SoftwareApplication');
const ldDoc = (script) => ({ readyState: 'complete', querySelectorAll: (sel) => (sel === 'script.js-ld-offer' ? [script] : []) });

test('AFMBP-2525: the JSON-LD baked into index.html carries offerLd(FALLBACK)', () => {
  const m = readFileSync('index.html', 'utf8').match(LD_RE);
  assert.ok(m, 'index.html has the js-ld-offer JSON-LD');
  assert.deepEqual(appNode(JSON.parse(m[1])).offers, P.offerLd(P.FALLBACK));
  const o = P.offerLd(P.FALLBACK);
  assert.equal(o.price, 59);
  assert.equal(o.priceCurrency, 'USD');
  assert.equal(o.description, '30-day free trial. Then $59/month for the first month, and $79/month after that. ' +
    'Includes 750 messages and 400 minutes per cycle, then $0.12/minute and $0.01/message.');
});

test('AFMBP-2525: the feed rewrites the JSON-LD offer, and only the offer', () => {
  const raw = readFileSync('index.html', 'utf8').match(LD_RE)[1];
  const before = JSON.parse(raw);
  const script = { textContent: raw };
  P.apply(ldDoc(script), FEED);
  const after = JSON.parse(script.textContent);
  assert.deepEqual(appNode(after).offers, P.offerLd(FEED));
  assert.equal(appNode(after).offers.price, 39.99);
  assert.match(appNode(after).offers.description, /^14-day free trial\. Then \$39\.99\/month for the first 6 months, and \$59\.99\/month after that\./);
  for (const n of before['@graph']) {
    if (n['@type'] !== 'SoftwareApplication') assert.deepEqual(after['@graph'].find((x) => x['@id'] === n['@id']), n);
  }
  const { offers: _a, ...appAfter } = appNode(after);
  const { offers: _b, ...appBefore } = appNode(before);
  assert.deepEqual(appAfter, appBefore);
});

test('AFMBP-2525: no trial and no promo are stated as such (0 is real); bad JSON-LD is left alone', () => {
  const o = P.offerLd({ ...P.FALLBACK, trialDays: 0, promoMonths: 0 });
  assert.equal(o.price, 79);
  assert.equal(o.description, '$79/month. Includes 750 messages and 400 minutes per cycle, then $0.12/minute and $0.01/message.');
  assert.deepEqual(o.priceSpecification.map((s) => s.name), ['Regular price']);
  const script = { textContent: '{not json' };
  assert.doesNotThrow(() => P.apply(ldDoc(script), FEED));
  assert.equal(script.textContent, '{not json');
});

/* AFMBP-2535 — the support page's FAQPage JSON-LD is rebuilt from the FAQ as shown. */
function faqDoc(items, json) {
  const script = { textContent: json };
  const fakeItems = items.map(([q, a]) => ({ querySelector: (sel) => (sel === 'summary' ? { textContent: q } : sel === '.sup-faq__a' ? { textContent: a } : null) }));
  return { script, doc: { readyState: 'complete', querySelectorAll: (sel) => (sel === 'script.js-ld-faq' ? [script] : sel === '.sup-faq__item' ? fakeItems : []) } };
}

test('AFMBP-2535: the FAQ JSON-LD is the FAQ as shown, one line per question and answer', () => {
  const { script, doc } = faqDoc(
    [['What is Bolt Answering?\n              ', '\n  Bolt Answering is an AI phone answering service.  '], ['How much?', '\n<p>Your first 14 days are free.</p>\n   <p>Month to month.</p>']],
    JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', '@id': 'x#faq', mainEntity: [] }),
  );
  P.apply(doc, FEED);
  const d = JSON.parse(script.textContent);
  assert.equal(d['@id'], 'x#faq');
  assert.deepEqual(d.mainEntity, [
    { '@type': 'Question', name: 'What is Bolt Answering?', acceptedAnswer: { '@type': 'Answer', text: 'Bolt Answering is an AI phone answering service.' } },
    { '@type': 'Question', name: 'How much?', acceptedAnswer: { '@type': 'Answer', text: '<p>Your first 14 days are free.</p> <p>Month to month.</p>' } },
  ]);
});

test('AFMBP-2535: bad FAQ JSON-LD, or a page with no FAQ items, is left alone', () => {
  const bad = faqDoc([['Q', 'A']], '{not json');
  assert.doesNotThrow(() => P.apply(bad.doc, FEED));
  assert.equal(bad.script.textContent, '{not json');
  const empty = faqDoc([], '{"@type":"FAQPage","mainEntity":[1]}');
  P.apply(empty.doc, FEED);
  assert.equal(empty.script.textContent, '{"@type":"FAQPage","mainEntity":[1]}');
});
