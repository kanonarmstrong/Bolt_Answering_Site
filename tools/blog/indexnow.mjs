#!/usr/bin/env node
/* Tell Bing (and other IndexNow engines) which blog URLs changed in the last commit,
   so new posts are picked up in minutes rather than days. Bing's index also feeds
   several AI assistants. The key is public by design: its file lives at the site root.

   Usage: node tools/blog/indexnow.mjs [<base-commit>]   (default: HEAD~1) */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from './lib/util.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const keyFile = readdirSync(repo).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));

/** Map changed repo paths to public URLs (pages only; images and indexes are skipped). */
export function changedUrls(paths) {
  const urls = new Set();
  for (const p of paths) {
    if (/^blog\/(?:.*\/)?index\.html$/.test(p)) urls.add(`${SITE_URL}/${p.replace(/index\.html$/, '')}`);
    if (p === 'sitemap.xml' || p === 'blog/feed.xml') urls.add(`${SITE_URL}/${p}`);
  }
  return [...urls];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!keyFile) { console.log('No IndexNow key file at the repo root; skipping.'); process.exit(0); }
  const base = process.argv[2] || 'HEAD~1';
  const out = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { cwd: repo, encoding: 'utf8' });
  const urlList = changedUrls(out.split('\n').filter(Boolean));
  if (!urlList.length) { console.log('No blog pages changed; nothing to ping.'); process.exit(0); }
  const key = keyFile.replace(/\.txt$/, '');
  const host = new URL(SITE_URL).host;
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation: `${SITE_URL}/${keyFile}`, urlList: urlList.slice(0, 10000) }),
  });
  console.log(`IndexNow: ${res.status} for ${urlList.length} URL(s)`);
  // 200/202 = accepted. Anything else is logged but never fails the publish.
}
