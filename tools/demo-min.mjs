// AFMBP-2657 — the demo's files, minified, for the ad landing pages (start/<trade>.html).
// The landing A/B's demo card (AFMBP-2612) loads demo.css, demo-format.js and demo.js once it has
// painted. These copies hold the same code in fewer bytes (42 KB gzip down to about 19), so the
// demo is ready sooner after the card shows. Every other page keeps loading the sources.
//   demo-format.min.js, demo.min.js  esbuild 0.28.2, --minify --target=es5 (the sources are ES5, so
//                                    nothing newer can appear in the output)
//   demo.min.css                     comments, indentation and line breaks out, nothing rewritten
//                                    (the same trim as the pages' own CSS in quick-landing-build.mjs)
// Each copy opens with the sha256 of its source. tools/quick-landing-build.mjs refuses to build,
// and tools/quick-landing-check.mjs fails, while a copy is older than its source.
// After editing demo.js, demo-format.js or demo.css, run from the site root:
//   ESBUILD=/path/to/esbuild node tools/demo-min.mjs   (without ESBUILD: npx --yes esbuild@0.28.2)
//   node tools/quick-landing-build.mjs && node tools/quick-landing-check.mjs
// node tools/demo-min.mjs --check   only says whether the copies match their sources (no esbuild).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ESBUILD_VERSION = '0.28.2';
export const FILES = [
  { src: 'demo-format.js', out: 'demo-format.min.js', kind: 'js' },
  { src: 'demo.js', out: 'demo.min.js', kind: 'js' },
  { src: 'demo.css', out: 'demo.min.css', kind: 'css' },
];
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
export const banner = (f, srcBytes) =>
  `/* ${f.out}: ${f.src} (sha256 ${sha256(srcBytes)}), minified by tools/demo-min.mjs${f.kind === 'js' ? ` with esbuild ${ESBUILD_VERSION}` : ''}. Edit ${f.src}, then run that again. */\n`;

// The copies whose first line doesn't name their source as it is now.
export function staleCopies(root = '.') {
  const out = [];
  for (const f of FILES) {
    let have = '';
    try { have = readFileSync(join(root, f.out), 'utf8'); } catch (e) {}
    if (!have.startsWith(banner(f, readFileSync(join(root, f.src))))) out.push(f.out);
  }
  return out;
}

// quick-landing-build.mjs's trimCss: comments out, each line trimmed, lines joined (with a space
// unless the line before ends a declaration, a block or a list item).
export const trimCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.trim()).filter(Boolean)
  .reduce((acc, l) => (acc && !/[{};,]$/.test(acc) ? `${acc} ${l}` : acc + l), '');

function esbuild() {
  const run = process.env.ESBUILD ? [process.env.ESBUILD, []] : ['npx', ['--yes', `esbuild@${ESBUILD_VERSION}`]];
  const v = execFileSync(run[0], [...run[1], '--version'], { encoding: 'utf8' }).trim();
  if (v !== ESBUILD_VERSION) throw new Error(`esbuild ${v}: this needs ${ESBUILD_VERSION}, so the copies stay byte for byte what was reviewed`);
  return (input) => execFileSync(run[0], [...run[1], '--minify', '--target=es5', '--log-level=warning'], { input, encoding: 'utf8', maxBuffer: 1 << 26 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const s = staleCopies();
    if (s.length) { console.error(`older than their sources: ${s.join(', ')}. Run node tools/demo-min.mjs`); process.exit(1); }
    console.log(`${FILES.map((f) => f.out).join(', ')}: current`);
  } else {
    const min = esbuild();
    for (const f of FILES) {
      const src = readFileSync(f.src);
      const body = f.kind === 'js' ? min(src).trimEnd() : trimCss(src.toString('utf8'));
      writeFileSync(f.out, `${banner(f, src)}${body}\n`);
      console.log(`${f.out}: ${src.length} -> ${body.length} bytes`);
    }
  }
}
