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

## One-time setup (about 30 minutes)

1. **Create the WordPress site** on a managed host whose plan allows plugins (WordPress.com
   Business, WP Engine, Kinsta, …).
2. **Point `cms.boltanswering.com` at it.** At your domain registrar, add the DNS record your host
   gives you (usually a CNAME), then set the site address to `https://cms.boltanswering.com` in the
   host's dashboard.
3. **Install the connector plugin.** In WordPress: Plugins → Add New → Upload Plugin → upload
   `tools/blog/wordpress/bolt-blog-connector.php` (zip it first if the host asks for a .zip).
   Activate it.
4. **Create the GitHub token.** github.com → Settings → Developer settings → Fine-grained tokens →
   Generate new token. Repository access: only `kanonarmstrong/Bolt_Answering_Site`. Permissions:
   **Contents: Read and write**. Expiration: up to a year (set a reminder to renew).
5. **Connect them.** In WordPress: Settings → Bolt Blog → paste the token → Save → **Send a test
   rebuild**. You should see "Rebuild requested."
6. **Tell GitHub where WordPress lives.** On GitHub: the site repo → Settings → Secrets and
   variables → Actions → **Variables** → New variable `WP_BASE_URL` = `https://cms.boltanswering.com`.
7. **Hide WordPress from search** (belt and braces; the plugin already does this): WordPress
   Settings → Reading → check "Discourage search engines from indexing this site".
8. **After the first post is live:** add `https://www.boltanswering.com` to
   [Google Search Console](https://search.google.com/search-console) and
   [Bing Webmaster Tools](https://www.bing.com/webmasters), and submit
   `https://www.boltanswering.com/sitemap.xml` in both.

## Writing a post that does well in search and AI answers

- **Title:** plain words a contractor would search for. The **Search title** field (sidebar,
  "Search & AI (Bolt)") can be longer or more keyword-heavy than the on-page title.
- **Search description:** one or two sentences, ~150 characters, answering the question directly.
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

- **Publish / update / unpublish / trash** a post: the blog rebuilds in about 1–2 minutes.
- **Nothing changed?** GitHub → Actions → "Blog" shows each run and its warnings. "Run workflow"
  rebuilds by hand. A daily run also catches anything missed.
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
- `blog/assets/css/benchy.css` is generated by `prepare-assets.mjs` from the licensed Benchy template
  (recolored, re-fonted to Inter). Put style changes in `blog/assets/css/blog.css`.
- The Benchy demo photos are not used or committed: they are stock images we don't have rights to
  publish.
- The IndexNow key is the `<32 hex>.txt` file at the repo root. It is public by design.
