/* HTML templates for the blog, built on the Benchy layout (blog.html / article.html)
   with Bolt's header, footer, analytics and privacy wiring. Every page is complete,
   readable HTML without JavaScript: the only script is search, menu and dropdown. */
import { esc, formatDate, postPath, categoryPath, pagePath, BLOG_PATH, SITE_NAME, PUBLISHER_LEGAL_NAME } from './util.mjs';

const ASSET_V = '14';
// The site's own one-line description (index.html <meta name="description">).

/* Same analytics bootstrap as the rest of the site: no tags for a browser that opted out
   (Your Privacy Choices / Global Privacy Control) or for our own ?bolt_qa test visits. */
const ANALYTICS = `<script>
    (function () {
      var q = location.search, off = false;
      try {
        if (/[?&]bolt_optout=1(&|$)/.test(q)) localStorage.setItem('bolt_optout', '1');
        else if (/[?&]bolt_optout=0(&|$)/.test(q)) localStorage.removeItem('bolt_optout');
        off = navigator.globalPrivacyControl === true || localStorage.getItem('bolt_optout') === '1';
        var qa = /[?&](bolt_qa|demoqa)=1(&|$)/.test(q) || (localStorage.getItem('bolt_qa') === '1' && !/[?&]bolt_qa=0(&|$)/.test(q));
        var debug = /[?&]bolt_pixel_debug=1(&|$)/.test(q) || sessionStorage.getItem('bolt_pixel_debug') === '1';
        if (qa && !debug) off = true;
      } catch (e) { off = navigator.globalPrivacyControl === true || (/[?&](bolt_qa|demoqa)=1(&|$)/.test(q) && !/[?&]bolt_pixel_debug=1(&|$)/.test(q)); }
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      if (off) return;
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=G-8C8SFMCRYH';
      document.head.appendChild(s);
      window.gtag('js', new Date());
      window.gtag('config', 'G-8C8SFMCRYH');
      window.gtag('config', 'AW-18483202475');
    })();
  </script>
  <script defer src="/attribution.js?v=6"></script>
  <script defer src="/meta-pixel.js?v=3"></script>
  <script defer src="/privacy-choices.js?v=2"></script>
  <script defer src="/sentry-init.js?v=1"></script>`;

const jsonLdTag = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

export function layout({ chrome, title, description, canonical, ogType = 'website', ogImage, jsonLd = [], body, robots = 'index, follow, max-image-preview:large', prev, next, published, modified }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${ANALYTICS}
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="${robots}" />
  <link rel="canonical" href="${esc(canonical)}" />${prev ? `\n  <link rel="prev" href="${esc(prev)}" />` : ''}${next ? `\n  <link rel="next" href="${esc(next)}" />` : ''}
  <link rel="alternate" type="application/rss+xml" title="Bolt Answering blog" href="/blog/feed.xml" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(canonical)}" />${ogImage ? `\n  <meta property="og:image" content="${esc(ogImage)}" />` : ''}${published ? `\n  <meta property="article:published_time" content="${published}" />\n  <meta property="article:modified_time" content="${modified}" />` : ''}
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}" />
  <!-- The app's sign-up is one tap away (AFMBP-2564): the plain preconnect warms the tap's navigation and the prefetches, the crossorigin one the signup-preload.json fetch -->
  <link rel="preconnect" href="https://app.boltanswering.com" />
  <link rel="preconnect" href="https://app.boltanswering.com" crossorigin />
  <link rel="preload" as="font" type="font/woff2" href="/assets/fonts/inter.woff2" crossorigin />
  ${chrome.styles.map((href) => `<link rel="stylesheet" href="${href}" />`).join('\n  ')}
  <link rel="stylesheet" href="/blog/assets/css/benchy.css?v=${ASSET_V}" />
  <link rel="stylesheet" href="/blog/assets/css/blog.css?v=${ASSET_V}" />
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png" />
  <link rel="icon" type="image/png" href="/assets/favicon.png" />
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
  ${jsonLd.map(jsonLdTag).join('\n  ')}
</head>
<body class="blog-page">
  <a class="skip-link" href="#main">Skip to content</a>
  ${chrome.header}

  <div class="bchy">
    <div class="main-wrapper">
${body}
    </div>
  </div>

  ${chrome.footer}

  ${chrome.scripts.map((src) => `<script src="${src}"></script>`).join('\n  ')}
  <script defer src="/blog/assets/js/blog.js?v=${ASSET_V}"></script>
</body>
</html>
`;
}

function picture(img, { sizes, eager = false } = {}) {
  if (!img) return '';
  return `<img src="${img.src}" srcset="${img.srcset}" sizes="${sizes}" width="${img.width}" height="${img.height}" alt="${esc(img.alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async" />`;
}

/** "Nov 6, 2026 | 2 min read" stamp on post cards, posts and Recent posts. The author is only in the post's
 *  JSON-LD and RSS (no author box on posts, owner 11-12, AFMBP-2571). */
const stamp = (p) => `<div class="infoline_date"><time datetime="${p.datePublished}">${formatDate(p.datePublished)}</time></div><span class="infoline_sep" aria-hidden="true">|</span><div class="infoline_tag">${p.minutes} min read</div>`;
const infoline = (p) => `<div class="article_infoline infoline">
                    ${stamp(p)}
                  </div>`;

function postCard(p, i) {
  const cat = p.categories[0];
  return `                <article class="article_item">
                  <div class="article_item_cover${p.image ? '' : ' article_item_cover-empty'}">
                    ${p.image ? `<a href="${postPath(p.slug)}" tabindex="-1" aria-hidden="true">${picture(p.image, { sizes: '(max-width: 1023px) 100vw, 850px', eager: i === 0 })}</a>` : ''}
                    ${cat ? `<a href="${categoryPath(cat.slug)}" class="cats_item">${esc(cat.name)}</a>` : ''}
                  </div>
                  ${infoline(p)}
                  <div class="article_txt">
                    <h2 class="article_title h2"><a href="${postPath(p.slug)}">${esc(p.title)}</a></h2>
                    <p class="article_desc">${esc(p.excerpt)} <a href="${postPath(p.slug)}" class="article_more" aria-label="Read more: ${esc(p.title)}">Read more</a></p>
                  </div>
                </article>`;
}

function pagination(current, total, base) {
  if (total <= 1) return '';
  const href = (n) => (base ? (n <= 1 ? base : `${base}page/${n}/`) : pagePath(n));
  const parts = [];
  if (current > 1) parts.push(`<a href="${href(current - 1)}" rel="prev" aria-label="Previous page"><span class="icon-arrow icon-arrow-prev" aria-hidden="true"></span></a>`);
  for (let n = 1; n <= total; n++) parts.push(n === current ? `<span class="current" aria-current="page">${n}</span>` : `<a href="${href(n)}">${n}</a>`);
  if (current < total) parts.push(`<a href="${href(current + 1)}" rel="next" aria-label="Next page"><span class="icon-arrow" aria-hidden="true"></span></a>`);
  return `<nav class="pagenavi" aria-label="Pages">${parts.join(' ')}</nav>`;
}

function sidebar({ recent, categories }) {
  return `            <aside class="columns_sidebar sidebar">
              <div class="sidebar_widget">
                <h3>Recent posts</h3>
                <div class="stories">
${recent.map((p) => `                  <div class="stories_item">
                    ${p.image ? `<div class="stories_item_img"><a href="${postPath(p.slug)}" tabindex="-1" aria-hidden="true">${picture(p.image, { sizes: '420px' })}</a></div>` : ''}
                    <div class="stories_item_infoline infoline">
                      ${stamp(p)}
                    </div>
                    <div class="stories_item_title"><a href="${postPath(p.slug)}">${esc(p.title)}</a></div>
                  </div>`).join('\n')}
                </div>
              </div>
              <div class="sidebar_widget sidebar_msearch">
              ${searchForm('blog-q-side')}
              </div>
${categories.length ? `              <div class="sidebar_widget">
                <h3>Categories</h3>
                <div class="cats">
                  ${categories.map((c) => `<a href="${categoryPath(c.slug)}" class="cats_item">${esc(c.name)}</a>`).join('')}
                </div>
              </div>` : ''}
            </aside>`;
}

/** Blog home (page n) and category pages share this list layout. */
export function listPage({ heading, crumbs, posts, current, total, base, recent, categories, intro }) {
  const inner = `            <div class="columns_center">
              ${intro ? `<p class="list_intro">${esc(intro)}</p>` : ''}
              <div class="article article_list">
${posts.length ? posts.map(postCard).join('\n') : '                <p>No posts yet. Check back soon.</p>'}
              </div>
              ${pagination(current, total, base)}
            </div>
${sidebar({ recent, categories })}`;
  return wrapMain({ heading, crumbs, inner });
}

function breadcrumbs(crumbs) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${crumbs
    .map((c, i) => (i < crumbs.length - 1 ? `<a href="${c.href}">${esc(c.name)}</a>` : `<span aria-current="page">${esc(c.name)}</span>`))
    .join(' <span class="dash"></span> ')}</nav>`;
}

/** "the bottom line" masthead: full-width hero band with the blog's wordmark (a Figma-outlined SVG).
 *  It is the page's <h1> when the page has no heading of its own (blog home), otherwise a link home. */
/** "Search posts" field. Each page has two: in the masthead (desktop) and under Recent posts
 *  (phones); CSS shows one per screen size, so ids differ. */
function searchForm(id) {
  return `<form action="${BLOG_PATH}search/" method="get" role="search" class="msearch js-search">
              <label class="visually-hidden" for="${id}">Search posts</label>
              <input type="search" id="${id}" name="q" class="msearch_input" placeholder="Search posts" autocomplete="off" />
              <button class="msearch_btn" aria-label="Search"><img src="/blog/assets/img/search.svg" alt="" width="23" height="23" /></button>
              <div class="search_results" role="status" aria-live="polite" hidden></div>
            </form>`;
}

function masthead(isH1) {
  const mark = '<img src="/blog/assets/img/the-bottom-line.svg" alt="the bottom line" width="476" height="48" />';
  const title = isH1
    ? `<h1 class="masthead_title">${mark}</h1>`
    : `<div class="masthead_title"><a href="${BLOG_PATH}">${mark}</a></div>`;
  return `      <div class="masthead">
        <div class="masthead_band">
          <picture>
            <source type="image/webp" sizes="100vw" srcset="/blog/assets/img/blog-hero-800.webp 800w, /blog/assets/img/blog-hero-1600.webp 1600w, /blog/assets/img/blog-hero-2400.webp 2400w" />
            <img class="masthead_bg" src="/blog/assets/img/blog-hero-1600.jpg" alt="" width="1600" height="272" />
          </picture>
          <div class="masthead_inner">${title}</div>
        </div>
        <div class="masthead_search">
          <div class="masthead_search_inner">
            ${searchForm('blog-q')}
          </div>
        </div>
      </div>`;
}

/** heading: the page's <h1> under the masthead (category name, "Search"). With no heading the
 *  masthead is the <h1>, unless the content has its own (articles: titleInContent).
 *  crumbs: omit for no breadcrumb line (blog home). */
function wrapMain({ heading, titleInContent = false, crumbs, inner }) {
  return `    <main class="content" id="main">
${masthead(!heading && !titleInContent)}
      <section class="section-post">
        <div class="wrapper">
          ${heading ? `<div class="pagetitle"><h1>${esc(heading)}</h1></div>` : ''}
          ${crumbs ? breadcrumbs(crumbs) : ''}
          <div class="columns">
${inner}
          </div>
        </div>
      </section>
    </main>`;
}

export function articlePage({ post, html, recent, categories, related }) {
  const cat = post.categories[0];
  const inner = `            <div class="columns_center">
              <article class="article">
                ${post.image ? `<div class="article_cover">${picture(post.image, { sizes: '(max-width: 1023px) 100vw, 850px', eager: true })}${cat ? `<a href="${categoryPath(cat.slug)}" class="cats_item">${esc(cat.name)}</a>` : ''}</div>` : ''}
                ${infoline(post)}
                <div class="article_txt">
                  <h1>${esc(post.title)}</h1>
${html}
                </div>
                ${post.tags.length ? `<div class="article_tags"><div class="article_tags_title">Tags:</div> ${post.tags.map((t) => `<span>#${esc(t.name)}</span>`).join(' <span class="dash"></span> ')}</div>` : ''}
              </article>
              ${related.length ? `<section class="related" aria-labelledby="related-h"><h2 id="related-h" class="h3">Keep reading</h2><ul>${related.map((r) => `<li><a href="${postPath(r.slug)}">${esc(r.title)}</a></li>`).join('')}</ul></section>` : ''}
            </div>
${sidebar({ recent, categories })}`;
  // The masthead links back to the blog; the article's own <h1> is the post title. No visible
  // breadcrumb line on posts (the BreadcrumbList JSON-LD in the head stays for search engines).
  return wrapMain({ titleInContent: true, inner });
}

export function searchPage({ recent, categories }) {
  const inner = `            <div class="columns_center">
              <div class="search_page">
                <p class="js-search-empty">Type a search in the box to find posts.</p>
                <noscript><p>Search needs JavaScript. You can browse <a href="${BLOG_PATH}">all posts</a> instead.</p></noscript>
                <div class="search_page_results" role="status" aria-live="polite"></div>
              </div>
            </div>
${sidebar({ recent, categories })}`;
  return wrapMain({ heading: 'Search', inner });
}

export { wrapMain };
