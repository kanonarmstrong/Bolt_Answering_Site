/* One-time (re-runnable) copy of the licensed Benchy template's CSS, icon font and
   decorative images into blog/assets/, recolored to Bolt's brand.

   Run: node tools/blog/prepare-assets.mjs "/path/to/Benchy - HTML Template"

   What changes versus the template:
   - Benchy's pink accents become Bolt blue (#2b7ffd), its light pink becomes a light blue.
   - The Spartan/Jost Google Fonts become the site's self-hosted Inter (no third-party font calls).
   - Nothing else. The template's stock demo photos (img/img*.jpg, ava*.png, bad*.jpg) are NOT
     copied: they came from Freepik/Depositphotos and are not ours to publish. */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(repo, 'blog', 'assets');

const COLOR_MAP = [
  [/#d93d59/gi, '#2b7ffd'],
  [/#e87373/gi, '#6aa6ff'],
  [/#f55c6e/gi, '#2b7ffd'],
  [/rgba\(217,\s*61,\s*89,/gi, 'rgba(43, 127, 253,'],
];
const FONT_MAP = [
  [/"Spartan", sans-serif/g, "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"],
  [/"Jost", sans-serif/g, "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"],
];

export function transformCss(css) {
  let t = css.replace(/\/\*# sourceMappingURL=.*?\*\//g, '');
  for (const [re, to] of [...COLOR_MAP, ...FONT_MAP]) t = t.replace(re, to);
  return (
    '/* Benchy - Blog & Magazine HTML Template (c) George_Fx, licensed via Envato/ThemeForest.\n' +
    '   Recolored and re-fonted for Bolt by tools/blog/prepare-assets.mjs. Do not edit by hand:\n' +
    '   put overrides in blog.css. */\n' +
    t
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = process.argv[2];
  if (!src) {
    console.error('Usage: node tools/blog/prepare-assets.mjs "<Benchy - HTML Template dir>"');
    process.exit(2);
  }
  for (const d of ['css', 'fonts', 'img', 'svg']) mkdirSync(join(out, d), { recursive: true });
  const css = readFileSync(join(src, 'css', 'style.css'), 'utf8');
  writeFileSync(join(out, 'css', 'benchy.css'), transformCss(css));
  for (const f of ['icomoon.eot', 'icomoon.svg', 'icomoon.ttf', 'icomoon.woff']) {
    copyFileSync(join(src, 'fonts', f), join(out, 'fonts', f));
  }
  for (const f of ['catbg.png', 'dashbg.png', 'newsletter.png']) {
    copyFileSync(join(src, 'img', f), join(out, 'img', f));
  }
  for (const f of ['comm.svg', 'quote.svg']) copyFileSync(join(src, 'svg', f), join(out, 'svg', f));
  console.log(`Wrote ${out}`);
}
