// AFMBP-2484 — the handyman hero carries the owner's copy (2026-10-31):
//   headline  "You work." (gray) + "We answer and book." (navy), the trade heroes' two-tone pattern;
//   subtitle  "Keep working your day job. Bolt handles your calls and fills your side-hustle schedule."
// and none of the copy it replaced is left in that headline or subtitle.
// This is the live HTML hero, shown wider than 768px. On phones the hero is a baked Figma image
// (assets/handy-hero-mobile.png), which changes only with a new export from the owner's node.
// Run: node tools/handyman-hero-check.mjs [siteRoot]
//      NC=oldtitle | NC=oldsub | NC=onetone — negative controls on the copy read; each must FAIL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';

const TITLE = '<span class="l-gray">You work.</span><span class="l-navy">We answer and book.</span>';
const SUB = 'Keep working your day job. Bolt handles your calls and fills your side-hustle schedule.';
const OLD = ['busy helping customers', 'Let us get the new ones scheduled', 'Stopping mid-job', 'breaks your momentum', 'next job just gets booked'];

// Negative controls: [text, replacement] on the copy this check reads.
const CONTROLS = {
  oldtitle: [TITLE, '<span class="l-gray">You&rsquo;re busy helping customers.</span><span class="l-navy">Let us get the new ones scheduled.</span>'],
  oldsub: [SUB, 'Stopping mid-job to answer a call breaks your momentum. Bolt takes it instead, so the next job just gets booked.'],
  onetone: ['<span class="l-gray">You work.</span>', '<span class="l-navy">You work.</span>'],
};

let html = readFileSync(join(ROOT, 'handyman.html'), 'utf8');
if (NC) {
  const c = CONTROLS[NC];
  if (!c) { console.error(`unknown NC=${NC}`); process.exit(2); }
  const before = html;
  html = html.replace(c[0], c[1]);
  if (html === before) { console.error(`NC=${NC} changed nothing: the control is not testing anything`); process.exit(2); }
  console.log(`negative control: ${NC}`);
}

const results = [];
const check = (ok, label) => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}`); };

const h1 = html.match(/<h1 class="tphero__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/);
const sub = html.match(/<p class="tphero__sub[^"]*"[^>]*>([\s\S]*?)<\/p>/);
const h1s = [...html.matchAll(/<h1[\s>]/g)].length;

check(h1s === 1, `handyman.html has one h1 (found ${h1s})`);
check(!!h1 && h1[1] === TITLE, `headline: "You work." gray, then "We answer and book." navy (got ${h1 ? JSON.stringify(h1[1]) : 'no hero h1'})`);
check(!!sub && sub[1] === SUB, `subtitle: the owner's sentence, verbatim (got ${sub ? JSON.stringify(sub[1]) : 'no hero subtitle'})`);
for (const o of OLD) check(!(h1 && h1[1].includes(o)) && !(sub && sub[1].includes(o)), `the hero headline and subtitle no longer say "${o}"`);

const fails = results.filter((r) => !r).length;
console.log(fails ? `FAIL ${fails} of ${results.length}` : `ALL PASS (${results.length} checks)`);
process.exit(fails ? 1 : 0);
