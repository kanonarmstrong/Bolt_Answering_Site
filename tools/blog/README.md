# Bolt blog (WordPress → boltanswering.com/blog)

You write in WordPress. When you publish, GitHub rebuilds the blog as plain, fast pages at
`https://www.boltanswering.com/blog/`, using the Benchy template in Bolt's colors. WordPress itself
stays out of search results; only the boltanswering.com pages are indexed.

```
WordPress (cms.boltanswering.com)  --publish-->  GitHub Actions "Blog"  --commit-->  GitHub Pages
        you write here                         tools/blog/build.mjs           boltanswering.com/blog
```

Built in for Google and AI search: article and breadcrumb structured data, FAQ structured data
(automatic when a post has an "FAQ" heading), canonical URLs, Open Graph cards, `sitemap.xml`,
`robots.txt` (all crawlers allowed, including AI), `llms.txt`, an RSS feed, responsive WebP images,
and an IndexNow ping to Bing on every change.

## One-time setup

This runs on **WordPress.com Personal**, which can't install custom plugins. No plugin and no
GitHub token are needed: GitHub checks WordPress for published posts every 15 minutes.

1. **WordPress.com site** at `cms.boltanswering.com` (CNAME at Namecheap → the value WordPress.com
   gives you; then make it the primary domain).
2. **Privacy:** WordPress.com → Settings → General → Privacy → **Public** with **Discourage search
   engines** checked. Never **Private** or **Coming soon**: both block the build from reading posts.
3. **Delete the sample "Hello world!" post** (and anything else you don't want public). Every
   published post goes to boltanswering.com/blog.
4. **GitHub variable:** repo → Settings → Secrets and variables → Actions → Variables →
   `WP_BASE_URL` = `https://cms.boltanswering.com`. The build finds the WordPress.com API itself.
5. **Google Search Console and Bing Webmaster Tools:** add the site and submit
   `https://www.boltanswering.com/sitemap.xml`.

**Publishing:** a post appears about 15 minutes after you click Publish (GitHub sometimes runs
schedules a few minutes late). For an immediate rebuild: GitHub → Actions → "Blog" → Run workflow.

**If you ever move to a plan or host that allows plugins** (WordPress.com Business, WP Engine, …),
install `tools/blog/wordpress/bolt-blog-connector.php` for near-instant rebuilds, its own search
fields, and redirecting the WordPress copy to boltanswering.com. Setup: Settings → Bolt Blog →
paste a GitHub fine-grained token for this repo only with "Contents: Read and write".

## Writing a post that does well in search and AI answers

- **Title:** plain words a contractor would search for. If your editor shows WordPress.com's
  **SEO** panel (Jetpack), its **title** and **description** fields are used for search results;
  otherwise the post title and the **Excerpt** are.
- **Search description / Excerpt:** one or two sentences, ~150 characters, answering the question
  directly.
- **Featured image:** always set one, and fill in its **Alt text** in the Media Library. The build
  warns about any image missing alt text. Images are resized and converted automatically; upload the
  original.
- **Category:** pick one. Each category gets its own page.
- **FAQ:** add a heading named exactly **FAQ** (or "Frequently asked questions"), then each question
  as a smaller heading (or a bold line ending in "?") followed by its answer. That section is marked
  up so Google and AI assistants can show the answers directly.
- **Links between posts:** link to the other post's WordPress address as usual; the build rewrites it
  to the boltanswering.com address.
- Scripts, embeds, iframes and custom styles in post content are removed on purpose.

## Day to day

- **Publish / update / unpublish / trash** a post: the blog updates within about 15 minutes.
- **Nothing changed?** GitHub → Actions → "Blog" shows each run and its warnings. "Run workflow"
  rebuilds right away.
- **Drafts never appear** on the site. Only published posts are read.

## Importing drafts

`make-wxr.mjs` turns markdown drafts into a WordPress import file. They arrive as **drafts**:

```bash
node tools/blog/make-wxr.mjs --out bolt-drafts.xml --category "How Bolt Works" post1.md post2.md
```

Then in WordPress: Tools → Import → WordPress → upload `bolt-drafts.xml`. Front matter `title_tag`,
`meta_description`, `slug` and `category` are carried over. A file whose front matter starts with
`STATUS:` is skipped (use it for held posts).

## For developers

```bash
cd tools/blog && npm ci && npm test                         # tests
node tools/blog/build.mjs --fixtures tools/blog/fixtures/wp  # build sample posts (writes into the repo; don't commit the result)
WP_BASE_URL=https://cms.boltanswering.com node tools/blog/build.mjs
```

- `build.mjs` writes `blog/**`, `sitemap.xml`, `robots.txt`, `llms.txt`, and records what it wrote in
  `blog/.manifest.json`. Anything generated last time but not this time (an unpublished post) is
  deleted. Hand-made files are never touched.
- Every blog page uses the marketing site's own header, footer, `styles.css` and `script.js`, copied
  at build time from `support/index.html` (header, stylesheet links) and `hvac.html` (footer, scripts)
  by `lib/chrome.mjs`. Change the header or footer on the site and the next blog build picks it up.
- `blog/assets/css/benchy.css` is generated by `prepare-assets.mjs` from the licensed Benchy template
  (recolored, re-fonted to Inter, and scoped to `.bchy`, the content between the site header and
  footer, so it never styles them). Put style changes in `blog/assets/css/blog.css`, scoped to `.bchy`
  and sized with `var(--bchy-rem)` rather than `rem`.
- The Benchy demo photos are not used or committed: they are stock images we don't have rights to
  publish.
- The IndexNow key is the `<32 hex>.txt` file at the repo root. It is public by design.
