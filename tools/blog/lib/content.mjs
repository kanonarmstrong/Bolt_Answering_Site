/* Turns WordPress post HTML into safe, fast, crawlable HTML for the static blog:
   sanitize, demote stray <h1>s, localize + resize images, rewrite internal links,
   and find an FAQ section for FAQPage structured data. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import sanitizeHtml from 'sanitize-html';
import sharp from 'sharp';
import { stripTags, decodeEntities, postPath } from './util.mjs';

export const IMAGE_WIDTHS = [480, 960, 1600];
const OG_WIDTH = 1200;

// AFMBP-2569: the site's blue "Talk to your new assistant" button (styles.css .btn.btn--blue; blog.css sizes it
// inside posts). A WordPress Buttons block becomes a paragraph of these buttons; no other class survives.
const BUTTON = 'btn btn--blue';
const hasClass = (attribs, name) => (attribs.class || '').split(/\s+/).includes(name);
const withoutClass = ({ class: _dropped, ...rest }) => rest;

// AFMBP-2570: the numbering a WordPress numbered list asks for (its List style: numbers, letters or Roman numerals,
// saved as type="a" or as an inline list-style-type) is kept as a class blog.css styles. An attribute selector
// can't tell type="a" from type="A" in HTML, and inline styles are dropped.
const OL_TYPES = { 1: 'decimal', a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman' };
export const OL_CLASSES = ['list-lower-alpha', 'list-upper-alpha', 'list-lower-roman', 'list-upper-roman'];
function olNumbering(attribs) {
  const fromStyle = ((attribs.style || '').match(/list-style-type\s*:\s*(decimal|lower-alpha|upper-alpha|lower-latin|upper-latin|lower-roman|upper-roman)/i) || [])[1];
  const kind = OL_TYPES[attribs.type] || (fromStyle && fromStyle.toLowerCase().replace('latin', 'alpha'));
  const { class: _c, style: _s, type: _t, ...rest } = attribs;
  return OL_CLASSES.includes(`list-${kind}`) ? { ...rest, class: `list-${kind}` } : rest;
}

const ALLOWED = {
  allowedTags: ['p', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'cite', 'q',
    'figure', 'figcaption', 'img', 'br', 'hr', 'code', 'pre', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'sup', 'sub', 'mark', 'span', 'div'],
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'alt', 'width', 'height', 'title'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
    ol: ['start', 'reversed'],
    '*': ['id'],
  },
  allowedClasses: { p: ['post-cta'], a: BUTTON.split(' '), ol: OL_CLASSES },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  transformTags: {
    h1: 'h2', b: 'strong', i: 'em',
    // WordPress Buttons block: <div class="wp-block-buttons"><div class="wp-block-button"><a class="wp-block-button__link">.
    // The outer box becomes <p class="post-cta">, the inner one is unwrapped below, the link gets the site button's classes.
    div: (tagName, attribs) => (hasClass(attribs, 'wp-block-buttons') ? { tagName: 'p', attribs: { class: 'post-cta' } } : { tagName, attribs: withoutClass(attribs) }),
    a: (tagName, attribs) => ({ tagName, attribs: hasClass(attribs, 'wp-block-button__link') ? { ...withoutClass(attribs), class: BUTTON } : withoutClass(attribs) }),
    p: (tagName, attribs) => ({ tagName, attribs: withoutClass(attribs) }),
    ol: (tagName, attribs) => ({ tagName, attribs: olNumbering(attribs) }),
  },
  exclusiveFilter: (frame) => (frame.tag === 'p' || frame.tag === 'div' || frame.tag === 'span') && !frame.text.trim() && !frame.mediaChildren?.length,
};

/** Sanitize post HTML. Scripts, iframes, styles, event handlers and classes are dropped (a WordPress Buttons
 *  block keeps only the site button's classes, AFMBP-2569). */
export function sanitize(html) {
  return sanitizeHtml(html, ALLOWED)
    .replace(/<div>\s*/g, '').replace(/\s*<\/div>/g, '')
    .replace(/<span>([\s\S]*?)<\/span>/g, '$1');
}

/**
 * AFMBP-2569: a post that ends with a paragraph holding only a link that offers the free trial ("Try Bolt free for
 * 30 days.") shows that link as the same blue button. The words and the link stay as written in WordPress.
 */
export function closingTrialButton(html) {
  return html.replace(/<p>\s*<a ((?:(?!class=)[^>])*)>([^<]+)<\/a>\s*<\/p>\s*$/, (m, attrs, text) =>
    (/\b(free|trial)\b/i.test(text) ? `<p class="post-cta"><a class="${BUTTON}" ${attrs}>${text}</a></p>` : m));
}

/** Hosts we will download images from: the WordPress site itself and WordPress.com's CDNs. */
export function isAllowedImageHost(host, wpHost) {
  return host === wpHost || /(^|\.)wp\.com$/.test(host) || /\.files\.wordpress\.com$/.test(host) || /(^|\.)wordpress\.com$/.test(host);
}

/**
 * Download (or read, for fixtures) one image, write responsive WebP sizes plus a JPEG for
 * social cards under blog/img/<slug>/, and return what the templates need. Files are named
 * by content hash, so re-running a build doesn't rewrite unchanged images.
 */
export async function processImage(src, { slug, repoRoot, wpHost, fixtureDir }) {
  let buf;
  if (fixtureDir && !/^https?:/i.test(src)) {
    buf = readFileSync(join(fixtureDir, src));
  } else {
    const url = new URL(src);
    if (!isAllowedImageHost(url.host, wpHost)) throw new Error(`Refusing image from unexpected host ${url.host}: ${src}`);
    const res = await fetch(url, { headers: { 'User-Agent': 'bolt-blog-build' } });
    if (!res.ok) throw new Error(`Image download failed: ${res.status} ${src}`);
    buf = Buffer.from(await res.arrayBuffer());
  }
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 10);
  const meta = await sharp(buf).metadata();
  const dir = join(repoRoot, 'blog', 'img', slug);
  mkdirSync(dir, { recursive: true });
  const widths = IMAGE_WIDTHS.filter((w) => w < meta.width);
  widths.push(Math.min(meta.width, IMAGE_WIDTHS.at(-1)));
  const uniq = [...new Set(widths)].sort((a, b) => a - b);
  const files = [];
  for (const w of uniq) {
    const name = `${hash}-${w}.webp`;
    const path = join(dir, name);
    if (!existsSync(path)) await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path);
    files.push({ w, url: `/blog/img/${slug}/${name}` });
  }
  const ogName = `${hash}-og.jpg`;
  const ogPath = join(dir, ogName);
  if (!existsSync(ogPath)) await sharp(buf).resize({ width: OG_WIDTH, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(ogPath);
  const largest = files.at(-1);
  const height = Math.round((meta.height / meta.width) * largest.w);
  return {
    src: largest.url,
    srcset: files.map((f) => `${f.url} ${f.w}w`).join(', '),
    width: largest.w,
    height,
    og: `/blog/img/${slug}/${ogName}`,
    files: [...files.map((f) => basename(f.url)), ogName],
  };
}

export const AVATAR_PX = 80; // drawn at the author name's font size (~20px): 4x covers retina

/**
 * The author's Gravatar (from WordPress's avatar_urls), downloaded at build time and saved as
 * blog/img/<slug>/<hash>-avatar.webp so readers' browsers never call gravatar.com. Asks
 * Gravatar for d=404, so an author without a Gravatar gets no image instead of a generated
 * pattern: returns null then. `cache` (a Map) avoids re-downloading the same author per post.
 */
export async function processAvatar(src, { slug, repoRoot, fixtureDir }, cache = new Map()) {
  let buf = cache.get(src);
  if (buf === undefined) {
    if (fixtureDir && !/^https?:/i.test(src)) {
      buf = readFileSync(join(fixtureDir, src));
    } else {
      const url = new URL(src);
      if (!/(^|\.)gravatar\.com$/.test(url.host)) throw new Error(`Refusing avatar from unexpected host ${url.host}`);
      url.searchParams.set('s', String(AVATAR_PX));
      url.searchParams.set('d', '404');
      const res = await fetch(url, { headers: { 'User-Agent': 'bolt-blog-build' } });
      if (res.status === 404) buf = null;
      else if (!res.ok) throw new Error(`Avatar download failed: ${res.status}`);
      else buf = Buffer.from(await res.arrayBuffer());
    }
    cache.set(src, buf);
  }
  if (!buf) return null;
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 10);
  const dir = join(repoRoot, 'blog', 'img', slug);
  mkdirSync(dir, { recursive: true });
  const name = `${hash}-avatar.webp`;
  const path = join(dir, name);
  if (!existsSync(path)) await sharp(buf).resize(AVATAR_PX, AVATAR_PX, { fit: 'cover' }).webp({ quality: 80 }).toFile(path);
  return { src: `/blog/img/${slug}/${name}`, file: name };
}

/** Rewrite links that point at the WordPress copy of a post to the post's /blog/ URL. */
export function rewriteLinks(html, { wpHost, linkMap }) {
  return html.replace(/<a\b([^>]*?)href="([^"]+)"([^>]*)>/g, (m, pre, href, post) => {
    let out = href;
    try {
      const u = new URL(decodeEntities(href), `https://${wpHost}`);
      if (u.host === wpHost) {
        const key = u.pathname.replace(/\/+$/, '/');
        const p = u.searchParams.get('p');
        const slug = linkMap.get(key) || (p && linkMap.get(`?p=${p}`));
        if (slug) out = postPath(slug) + (u.hash || '');
      }
    } catch { /* relative or odd href: leave it */ }
    let attrs = `${pre}href="${out}"${post}`;
    if (/target="_blank"/.test(attrs) && !/rel=/.test(attrs)) attrs += ' rel="noopener"';
    return `<a${attrs}>`;
  });
}

/** Find an FAQ section: an h2 named FAQ / Frequently asked questions, then h3 or bold-paragraph questions. */
export function extractFaq(html) {
  const sec = html.match(/<h2[^>]*>\s*(?:faqs?|frequently asked questions)\s*<\/h2>([\s\S]*?)(?=<h2[\s>]|$)/i);
  if (!sec) return [];
  const body = sec[1];
  const items = [];
  const re = /(?:<h3[^>]*>([\s\S]*?)<\/h3>|<p>\s*<strong>([^<]*\?)\s*<\/strong>\s*(?:<br\s*\/?>)?([\s\S]*?)<\/p>)/gi;
  const marks = [];
  let m;
  while ((m = re.exec(body))) marks.push({ index: m.index, end: re.lastIndex, q: stripTags(m[1] || m[2]), inline: m[3] });
  for (let i = 0; i < marks.length; i++) {
    const { q, inline, end } = marks[i];
    const until = i + 1 < marks.length ? marks[i + 1].index : body.length;
    const a = stripTags((inline || '') + ' ' + body.slice(end, until));
    if (q.endsWith('?') && a) items.push({ q, a });
  }
  return items;
}

/** Full content pipeline for one post. Returns the HTML plus warnings for the build report. */
export async function processContent(post, ctx) {
  const warnings = [];
  let html = closingTrialButton(sanitize(post.contentHtml));
  html = rewriteLinks(html, ctx);
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const keepFiles = [];
  for (const tag of imgs) {
    const src = (tag.match(/src="([^"]+)"/) || [])[1];
    const alt = decodeEntities((tag.match(/alt="([^"]*)"/) || [])[1] || '').trim();
    if (!src) { html = html.replace(tag, ''); continue; }
    if (!alt) warnings.push(`"${post.title}": image without alt text (${src}). Add alt text in WordPress.`);
    try {
      const img = await processImage(decodeEntities(src), { slug: post.slug, ...ctx });
      keepFiles.push(...img.files);
      html = html.replace(tag, `<img src="${img.src}" srcset="${img.srcset}" sizes="(max-width: 1023px) 100vw, 760px" width="${img.width}" height="${img.height}" alt="${alt.replace(/"/g, '&quot;')}" loading="lazy" decoding="async">`);
    } catch (e) {
      warnings.push(`"${post.title}": ${e.message}`);
      html = html.replace(tag, '');
    }
  }
  return { html, faq: extractFaq(html), warnings, keepFiles };
}
