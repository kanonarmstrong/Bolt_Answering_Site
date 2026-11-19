// AFMBP-2612 — bake the landing A/B's definition into the /start/ pages, AFTER the owner has started
// the experiment on the platform (never before: a draft is not in the public config, and the
// fields that drive assignment are frozen only once it runs).
//   node tools/xp/bake.mjs                 fetch the public config (read-only, no key)
//   node tools/xp/bake.mjs <saved.json>    use a saved copy of that fetch instead
// It saves the fetch as tools/xp/public-config-snapshot.json (committed with the PR: the guard test
// compares the bake with it, never with a live fetch, because the experiment leaves the endpoint
// once it completes) and rewrites tools/xp/landing_demo_buttons.json with baked true and the
// started experiment's key, seed, traffic, arms (order and allocations), unit and configVersion.
// Then: node tools/quick-landing-build.mjs && node tools/xp-assign-check.mjs && node tools/xp-landing-check.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const URL_ = 'https://bolt-experiments.fly.dev/v1/config?environment=production&platform=web';
const DEF_PATH = 'tools/xp/landing_demo_buttons.json';
const SNAP_PATH = 'tools/xp/public-config-snapshot.json';
const die = (m) => { console.error(`bake: ${m}`); process.exit(1); };

const def = JSON.parse(readFileSync(DEF_PATH, 'utf8'));
let snap;
if (process.argv[2]) snap = JSON.parse(readFileSync(process.argv[2], 'utf8'));
else {
  const r = await fetch(URL_, { headers: { accept: 'application/json' } });
  if (!r.ok) die(`GET ${URL_} answered ${r.status}`);
  snap = await r.json();
}
if (!Number.isInteger(snap.configVersion) || snap.configVersion < 1) die(`no configVersion in the config: ${JSON.stringify(snap).slice(0, 200)}`);
if (snap.environment !== 'production') die(`environment is ${snap.environment}, not production`);
const e = (snap.experiments || []).find((x) => x.key === def.key);
if (!e) die(`${def.key} is not in the public config. Has the owner started it? (A draft does not appear; listed: ${(snap.experiments || []).map((x) => `${x.key} ${x.status}`).join(', ') || 'none'})`);
if (e.status !== 'running') die(`${def.key} is ${e.status}, not running`);
if (!(e.platforms || []).includes('web')) die(`${def.key} is not on web: ${JSON.stringify(e.platforms)}`);
if (e.assignmentUnit !== 'anonymous') die(`${def.key} assigns by ${e.assignmentUnit}; the page decides by visitor (bolt_vid), so it must be anonymous`);
if ((e.overrides || []).length) die(`${def.key} has overrides; the SPEC says none for this test`);
const keys = e.variants.map((v) => v.key);
if (keys.length !== 2 || keys[0] !== 'control' || keys[1] !== 'treatment') die(`arms are ${JSON.stringify(keys)}; the page knows control (the sign-up card) and treatment (the demo card), in that order`);
const sum = e.variants.reduce((a, v) => a + v.allocation, 0);
if (sum !== 10000) die(`allocations add up to ${sum}, not 10000`);
if (!Number.isInteger(e.trafficPercentage) || e.trafficPercentage < 1 || e.trafficPercentage > 100) die(`trafficPercentage ${e.trafficPercentage}`);

const was = { key: def.key, seed: def.seed, trafficPercentage: def.trafficPercentage, variants: def.variants };
const now = { key: e.key, seed: e.seed, trafficPercentage: e.trafficPercentage, variants: e.variants.map((v) => ({ key: v.key, allocation: v.allocation })) };
const changed = JSON.stringify(was) !== JSON.stringify(now);
writeFileSync(SNAP_PATH, JSON.stringify(snap, null, 2) + '\n');
writeFileSync(DEF_PATH, JSON.stringify({
  baked: true,
  note: `BAKED ${new Date().toISOString()} from the public config (${URL_}), saved in ${SNAP_PATH}. Every visitor is now split, and exposures go to the platform.`,
  key: e.key, seed: e.seed, trafficPercentage: e.trafficPercentage, assignmentUnit: e.assignmentUnit,
  variants: now.variants, configVersion: snap.configVersion,
}, null, 2) + '\n');
console.log(`baked ${e.key}: seed ${e.seed}, traffic ${e.trafficPercentage}%, ${now.variants.map((v) => `${v.key} ${v.allocation}`).join(' / ')}, configVersion ${snap.configVersion}`);
if (changed) console.log(`NOTE the started experiment differs from the SPEC's expected values (${JSON.stringify(was)}). tools/xp/landing_demo_buttons.vectors.json pins those, so xp-assign-check will fail until the Experimentation platform session regenerates the vectors for the started key and seed.`);
console.log('next: node tools/quick-landing-build.mjs && node tools/xp-assign-check.mjs && node tools/xp-landing-check.mjs');
