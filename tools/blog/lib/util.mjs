/* Small, dependency-free helpers shared by the blog build. */

export const SITE_URL = 'https://www.boltanswering.com';
export const BLOG_PATH = '/blog/';
export const SITE_NAME = 'Bolt Answering';
export const PUBLISHER_LEGAL_NAME = 'hlpr inc.';
export const LOGO_URL = `${SITE_URL}/assets/logo.png`;
export const POSTS_PER_PAGE = 10;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

/** Decode the HTML entities WordPress puts in rendered titles and excerpts. */
export function decodeEntities(s = '') {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Escape text for an HTML text node or a double-quoted attribute. */
export function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape for XML (sitemap, RSS). */
export const escXml = esc;

/** Strip tags and collapse whitespace: the plain text of an HTML fragment. */
export function stripTags(html = '') {
  return decodeEntities(String(html).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Trim plain text to about `max` characters on a word boundary. */
export function truncate(text, max = 160) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,.;:]+$/, '') + '…';
}

/** "Nov 8, 2026" in US English, from an ISO date. Always UTC so builds are stable. */
export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Lowercase, hyphenated, ASCII-only slug. */
export function slugify(s = '') {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Absolute site URL for a site-relative path. */
export const abs = (path) => SITE_URL + (path.startsWith('/') ? path : `/${path}`);

export const postPath = (slug) => `${BLOG_PATH}${slug}/`;
export const categoryPath = (slug) => `${BLOG_PATH}category/${slug}/`;
export const pagePath = (n) => (n <= 1 ? BLOG_PATH : `${BLOG_PATH}page/${n}/`);

/** Approximate reading time in minutes (230 words per minute, minimum 1). */
export function readingMinutes(text) {
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 230));
}
