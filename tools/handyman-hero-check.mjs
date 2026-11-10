// AFMBP-2484 (D1, owner-approved 11-09) — the handyman hero keeps the owner's 11-02 headline and gets his
// side-hustle subtitle (2026-10-31):
//   headline  the hidden "Bolt Answering for Handymen: " prefix (AFMBP-2525), then "You’re busy working." (gray)
//             + "We'll get new work scheduled." (navy), exactly as he wrote it (curly and straight apostrophes);
//   subtitle  "Keep working your day job. Bolt handles your calls and fills your side-hustle schedule."
// and none of the copy it replaced is left in the subtitle. The page's meta description (Google's snippet) is the
// new subtitle, and og:description / twitter:description repeat it, so search results and link cards match.
// This is the live HTML hero, shown wider than 768px. On phones the hero is a baked Figma image
// (assets/handy-hero-mobile.png), which changes only with a new export from the owner's node (D2).
// Run: node tools/handyman-hero-check.mjs [siteRoot]
//      NC=oldtitle | NC=pr111title | NC=oldsub | NC=onetone | NC=oldmeta | NC=oldog — negative controls on the copy
//      read; each must FAIL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const NC = process.env.NC || '';

const TITLE = '<span class="sr-only">Bolt Answering for Handymen: </span><span class="l-gray">You&rsquo;re busy working.</span><span class="l-navy">We\'ll get new work scheduled.</span>';
const SUB = 'Keep working your day job. Bolt handles your calls and fills your side-hustle schedule.';
const OLD_SUB = ['Stopping mid-job', 'breaks your momentum', 'next job just gets booked'];

// Negative controls: [text, replacement] on the copy this check reads.
const CONTROLS = {
  // The headline the owner replaced on 11-02.
  oldtitle: ['<span class="l-gray">You&rsquo;re busy working.</span><span class="l-navy">We\'ll get new work scheduled.</span>', '<span class="l-gray">You&rsquo;re busy helping customers.</span><span class="l-navy">Let us get the new ones scheduled.</span>'],
  // The headline PR 111 first carried, which would have overwritten his 11-02 edit.
  pr111title: ['<span class="l-gray">You&rsquo;re busy working.</span><span class="l-navy">We\'ll get new work scheduled.</span>', '<span class="l-gray">You work.</span><span class="l-navy">We answer and book.</span>'],
  oldsub: [`data-rd="260">${SUB}</p>`, 'data-rd="260">Stopping mid-job to answer a call breaks your momentum. Bolt takes it instead, so the next job just gets booked.</p>'],
  onetone: ['<span class="l-gray">You&rsquo;re busy working.</span>', '<span class="l-navy">You&rsquo;re busy working.</span>'],
  oldmeta: [`<meta name="description" content="${SUB}" />`, '<meta name="description" content="Stopping mid-job to answer a call breaks your momentum. Bolt takes it, so the next job just gets booked." />'],
  oldog: [`<meta property="og:description" content="${SUB}" />`, '<meta property="og:description" content="Stopping mid-job to answer a call breaks your momentum. Bolt takes it, so the next job just gets booked." />'],
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
const meta = (attr, name) => [...html.matchAll(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`, 'g'))].map((m) => m[1]);

check(h1s === 1, `handyman.html has one h1 (found ${h1s})`);
check(!!h1 && h1[1] === TITLE, `headline: the owner's 11-02 words, verbatim, gray then navy, after the hidden prefix (got ${h1 ? JSON.stringify(h1[1]) : 'no hero h1'})`);
check(!!sub && sub[1] === SUB, `subtitle: the owner's sentence, verbatim (got ${sub ? JSON.stringify(sub[1]) : 'no hero subtitle'})`);
for (const o of OLD_SUB) check(!(sub && sub[1].includes(o)), `the subtitle no longer says "${o}"`);
for (const [attr, name] of [['name', 'description'], ['property', 'og:description'], ['name', 'twitter:description']]) {
  const got = meta(attr, name);
  check(got.length === 1 && got[0] === SUB, `${name} is the new subtitle (got ${JSON.stringify(got)})`);
}

const fails = results.filter((r) => !r).length;
console.log(fails ? `FAIL ${fails} of ${results.length}` : `ALL PASS (${results.length} checks)`);
process.exit(fails ? 1 : 0);
