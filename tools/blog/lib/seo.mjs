/* Structured data, sitemap, RSS, robots.txt and llms.txt: the pieces search engines
   and AI assistants read to find, understand and cite the blog. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { abs, escXml, postPath, categoryPath, BLOG_PATH, SITE_URL, SITE_NAME, PUBLISHER_LEGAL_NAME, LOGO_URL } from './util.mjs';

const PUBLISHER = { '@type': 'Organization', name: SITE_NAME, legalName: PUBLISHER_LEGAL_NAME, url: SITE_URL, logo: { '@type': 'ImageObject', url: LOGO_URL } };

export function articleJsonLd(post) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title.slice(0, 110),
    description: post.description,
    ...(post.image ? { image: [abs(post.image.og)] } : {}),
    datePublished: post.datePublished,
    dateModified: post.dateModified,
    author: { '@type': 'Person', name: post.author.name },
    publisher: PUBLISHER,
    mainEntityOfPage: { '@type': 'WebPage', '@id': abs(postPath(post.slug)) },
    url: abs(postPath(post.slug)),
    ...(post.categories[0] ? { articleSection: post.categories[0].name } : {}),
    ...(post.tags.length ? { keywords: post.tags.map((t) => t.name).join(', ') } : {}),
    wordCount: post.wordCount,
    inLanguage: 'en-US',
  };
}

export function breadcrumbJsonLd(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, ...(c.href ? { item: abs(c.href) } : {}) })),
  };
}

export function faqJsonLd(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
}

export function blogJsonLd(posts) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Bolt Answering blog',
    url: abs(BLOG_PATH),
    publisher: PUBLISHER,
    blogPost: posts.slice(0, 20).map((p) => ({ '@type': 'BlogPosting', headline: p.title.slice(0, 110), url: abs(postPath(p.slug)), datePublished: p.datePublished })),
  };
}

/* Marketing pages already on the site, found by scanning for HTML files. Pages that ask
   not to be indexed are left out. */
export function staticPages(repoRoot) {
  const skip = new Set(['blog', 'tools', 'vendor', 'node_modules', '.git', '.github', 'assets']);
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (!skip.has(name) && !name.startsWith('.')) walk(full); continue; }
      if (!name.endsWith('.html') || name === '404.html') continue;
      const html = readFileSync(full, 'utf8');
      if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) continue;
      let path = '/' + relative(repoRoot, full).split('\\').join('/');
      path = path.replace(/(^|\/)index\.html$/, '$1');
      // No lastmod for hand-made pages: file dates reset on every CI checkout, which would
      // churn the sitemap daily. Blog URLs carry real dates from WordPress.
      out.push({ path });
    }
  };
  walk(repoRoot);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function sitemapXml({ pages, posts, categories, listPages }) {
  const newest = posts[0]?.dateModified?.slice(0, 10);
  const urls = [
    ...pages.map((p) => ({ loc: abs(p.path), lastmod: p.lastmod })),
    ...listPages.map((path) => ({ loc: abs(path), lastmod: newest })),
    ...categories.map((c) => ({ loc: abs(categoryPath(c.slug)), lastmod: newest })),
    ...posts.map((p) => ({ loc: abs(postPath(p.slug)), lastmod: p.dateModified.slice(0, 10) })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${escXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

export function rssXml(posts) {
  const items = posts.slice(0, 30).map((p) => `    <item>
      <title>${escXml(p.title)}</title>
      <link>${abs(postPath(p.slug))}</link>
      <guid isPermaLink="true">${abs(postPath(p.slug))}</guid>
      <pubDate>${new Date(p.datePublished).toUTCString()}</pubDate>
      <dc:creator>${escXml(p.author.name)}</dc:creator>
${p.categories.map((c) => `      <category>${escXml(c.name)}</category>`).join('\n')}
      <description>${escXml(p.description)}</description>
      <content:encoded><![CDATA[${p.html.replace(/]]>/g, ']]]]><![CDATA[>')}]]></content:encoded>
    </item>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Bolt Answering blog</title>
    <link>${abs(BLOG_PATH)}</link>
    <atom:link href="${abs('/blog/feed.xml')}" rel="self" type="application/rss+xml" />
    <description>Practical advice for independent HVAC, plumbing, and electrical pros, from Bolt Answering.</description>
    <language>en-us</language>
${posts[0] ? `    <lastBuildDate>${new Date(posts[0].dateModified).toUTCString()}</lastBuildDate>\n` : ''}${items.join('\n')}
  </channel>
</rss>
`;
}

/* Owner decision (2026-11-07): allow every crawler, including AI search and AI training
   bots. The named AI user-agents are listed explicitly so the choice is visible. */
export function robotsTxt() {
  const ai = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bingbot', 'Googlebot'];
  return `# boltanswering.com: all crawlers welcome, including AI search and training crawlers.
User-agent: *
Allow: /

${ai.map((a) => `User-agent: ${a}`).join('\n')}
Allow: /

Sitemap: ${abs('/sitemap.xml')}
`;
}

/* llms.txt (https://llmstxt.org): a plain-markdown map of the site for AI assistants. */
const TRADE_NAMES = { '/hvac.html': 'HVAC', '/plumbing.html': 'Plumbing', '/electrical.html': 'Electrical', '/handyman.html': 'Handyman', '/general-contractor.html': 'General contracting' };

export function llmsTxt({ posts, pages }) {
  const trade = pages.filter((p) => /^\/(hvac|plumbing|electrical|handyman|general-contractor)\.html$/.test(p.path));
  const lines = [
    '# Bolt Answering',
    '',
    '> Bolt Answering is a smart assistant for independent HVAC, plumbing, electrical, handyman, and general contracting pros. It answers the calls you miss, books jobs into your calendar, and texts you the details, in English or Spanish.',
    '',
    "Bolt Answering is an independent product at boltanswering.com and isn't affiliated with other companies that use the name Bolt.",
    '',
    '## Product',
    `- [Home](${abs('/')}): what Bolt Answering does and how to get started`,
    ...trade.map((p) => `- [${TRADE_NAMES[p.path] || p.path}](${abs(p.path)})`),
    `- [Support](${abs('/support/')})`,
  ];
  if (posts.length) lines.push('', '## Blog', ...posts.map((p) => `- [${p.title}](${abs(postPath(p.slug))}): ${p.description}`));
  lines.push('', '## Optional', ...(posts.length ? [`- [RSS feed](${abs('/blog/feed.xml')})`] : []), `- [Sitemap](${abs('/sitemap.xml')})`);
  return lines.join('\n') + '\n';
}
