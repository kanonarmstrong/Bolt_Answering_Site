/* The blog uses the marketing site's own header, footer, stylesheet and scripts, copied from
   the site's pages at build time, so the two can never drift apart: change the header on the
   site and the next blog build picks it up.

   Sources:
     header      support/index.html  (already uses absolute links)
     footer      hvac.html           (+ the floating "Get started now" button after it)
     styles      support/index.html  (fonts.css + styles.css links, with their ?v= versions)
     scripts     hvac.html           (pricing.js, script.js)
   Relative links in the copied markup are made absolute so they work from /blog/<post>/. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Make one href/src value work from any depth: "x.html" -> "/x.html", "#pricing" -> "/#pricing",
 *  "index.html#how" -> "/#how". Absolute URLs, mailto/tel, "/…" and a bare "#" are unchanged. */
export function absolutizeUrl(u) {
  if (!u || u === '#' || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(u)) return u;
  if (u.startsWith('#')) return `/${u}`;
  const [path, hash = ''] = u.split('#');
  const clean = path.replace(/^\.\//, '');
  const abs = clean === 'index.html' || clean === '' ? '/' : `/${clean}`;
  return hash ? `${abs}#${hash}` : abs;
}

export function absolutize(html) {
  return html.replace(/\b(href|src)="([^"]*)"/g, (m, attr, u) => `${attr}="${absolutizeUrl(u)}"`);
}

function between(html, start, end, file) {
  const i = html.indexOf(start);
  const j = i < 0 ? -1 : html.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error(`Site chrome: couldn't find ${start}…${end} in ${file}`);
  return html.slice(i, j + end.length);
}

export function readSiteChrome(repoRoot) {
  const supportFile = join(repoRoot, 'support', 'index.html');
  const tradeFile = join(repoRoot, 'hvac.html');
  const support = readFileSync(supportFile, 'utf8');
  const trade = readFileSync(tradeFile, 'utf8');

  let header = absolutize(between(support, '<header class="nav"', '</header>', supportFile));
  // Mark the Blog link as the current section.
  header = header.replace('<a href="/blog/">Blog</a>', '<a href="/blog/" aria-current="page">Blog</a>');

  let footer = absolutize(between(trade, '<footer class="footer">', '</footer>', tradeFile));
  const cta = trade.match(/<a [^>]*class="[^"]*floating-cta[^"]*"[^>]*>[^<]*<\/a>/);
  if (cta) footer += `\n  ${absolutize(cta[0])}`;

  const styles = [...support.matchAll(/<link rel="stylesheet" href="(\/(?:assets\/fonts\.css|styles\.css)[^"]*)"\s*\/?>/g)].map((m) => m[1]);
  if (!styles.some((s) => s.startsWith('/styles.css'))) throw new Error(`Site chrome: no styles.css link in ${supportFile}`);

  const scripts = [...trade.matchAll(/<script src="((?:\/)?(?:pricing|script)\.js[^"]*)"><\/script>/g)].map((m) => absolutizeUrl(m[1]));
  if (!scripts.some((s) => s.startsWith('/script.js'))) throw new Error(`Site chrome: no script.js in ${tradeFile}`);

  return { header, footer, styles, scripts };
}
