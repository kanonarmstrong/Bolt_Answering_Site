#!/usr/bin/env node
/* One-time setup for the blog's "Top 5" (AFMBP-2691): check that a Google service-account key
   can read the site's Google Analytics, then save it as the GitHub secret GA4_SA_KEY. The key
   is never printed.

   Usage: node tools/blog/ga4-key-setup.mjs <key.json> [--repo owner/name] [--no-save]

   The key: Google Cloud console → IAM & Admin → Service accounts → an account with Viewer
   access to the GA4 property → Keys → Add key → Create new key → JSON. Delete the downloaded
   file once it is saved. */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fetchReaders, parseKey } from './lib/top-posts.mjs';

const DEFAULT_REPO = 'kanonarmstrong/Bolt_Answering_Site';

async function main(argv) {
  let file = '';
  let repo = DEFAULT_REPO;
  let save = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repo = argv[++i] || '';
    else if (argv[i] === '--no-save') save = false;
    else if (!file) file = argv[i];
  }
  if (!file || !repo) throw new Error('usage: node tools/blog/ga4-key-setup.mjs <key.json> [--repo owner/name] [--no-save]');

  let json;
  try { json = readFileSync(file, 'utf8'); } catch (e) { throw new Error(`can't read ${file} (${e.code})`); }
  const key = parseKey(json);
  const readers = await fetchReaders({ key });
  console.log(`Google Analytics read OK: ${readers.size} blog page(s) have readers.`);

  if (!save) { console.log('--no-save: the key was not stored anywhere.'); return; }
  const r = spawnSync('gh', ['secret', 'set', 'GA4_SA_KEY', '--repo', repo], { input: json, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error('gh secret set failed. Is the GitHub CLI signed in (gh auth status) with access to the repo?');
  console.log(`Saved as the GitHub Actions secret GA4_SA_KEY on ${repo}.`);
  console.log(`Now delete the downloaded key file:\n  rm "${file}"`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((e) => { console.error(`Stopped: ${e.message}`); process.exit(1); });
}
