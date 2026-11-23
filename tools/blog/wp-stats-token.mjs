#!/usr/bin/env node
/* One-time setup for the blog's "Top 5" (AFMBP-2691): get a WordPress.com token that can read
   Stats and save it as the GitHub secret WP_STATS_TOKEN. Neither the token nor the app's
   Client Secret is ever printed.

   1. https://developer.wordpress.com/apps/new: any name and description, Website URL
      https://www.boltanswering.com, Redirect URL http://localhost:8723/callback, Type "Web".
      Create it and keep the page open (it shows the Client ID and Client Secret).
   2. node tools/blog/wp-stats-token.mjs
      It asks for the Client ID and the Client Secret (typed hidden), opens WordPress.com to
      approve, reads Stats once to prove the token works, then saves it with the GitHub CLI.

   Flags: --client-id <id>  --scope <scopes> (default "stats"; "" = WordPress's single-site
   default)  --site <host> (default cms.boltanswering.com)  --repo <owner/name>  --no-save */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fetchViews } from './lib/top-posts.mjs';

export const PORT = 8723;
export const REDIRECT = `http://localhost:${PORT}/callback`;
const DEFAULTS = { site: 'cms.boltanswering.com', repo: 'kanonarmstrong/Bolt_Answering_Site', scope: 'stats' };

export function authorizeUrl({ clientId, state, site = DEFAULTS.site, scope = DEFAULTS.scope }) {
  const qs = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', blog: `https://${site}`, state });
  if (scope) qs.set('scope', scope);
  return `https://public-api.wordpress.com/oauth2/authorize?${qs}`;
}

/** WordPress.com's redirect back to us: the code, or why there is none. */
export function parseCallback(url, state) {
  const u = new URL(url, REDIRECT);
  const err = u.searchParams.get('error');
  if (err) return { error: `WordPress.com said "${err}"${u.searchParams.get('error_description') ? `: ${u.searchParams.get('error_description')}` : ''}` };
  if (u.searchParams.get('state') !== state) return { error: 'the reply did not match this run (state mismatch); start again' };
  const code = u.searchParams.get('code');
  return code ? { code } : { error: 'the reply had no code' };
}

export function tokenRequestBody({ clientId, clientSecret, code }) {
  return new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: REDIRECT });
}

export async function exchangeCode({ clientId, clientSecret, code, fetchImpl = fetch }) {
  const res = await fetchImpl('https://public-api.wordpress.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: tokenRequestBody({ clientId, clientSecret, code }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`WordPress.com didn't issue a token: HTTP ${res.status}${body.error ? ` ${body.error}` : ''}${body.error_description ? ` (${body.error_description})` : ''}`);
  }
  return { token: body.access_token, blogUrl: body.blog_url || '' };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? '') : fallback;
}

async function ask(question, { hidden = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => { if (s.startsWith(question) || s === '\r\n' || s === '\n') write(s); };
  }
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim();
}

function waitForCallback(state, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const servers = [];
    let timer;
    const finish = (fn, value) => { clearTimeout(timer); servers.forEach((s) => s.close()); fn(value); };
    const handler = (req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const r = parseCallback(u.href, state);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
        .end(r.code ? '<p>Done. You can close this tab and go back to the terminal.</p>' : '<p>That didn\'t work. Check the terminal.</p>');
      if (r.code) finish(resolve, r.code); else finish(reject, new Error(r.error));
    };
    for (const host of ['127.0.0.1', '::1']) {
      const s = createServer(handler);
      s.on('error', (e) => { if (host === '127.0.0.1') finish(reject, new Error(`can't listen on ${REDIRECT} (${e.code}); close whatever uses port ${PORT} and retry`)); });
      s.listen(PORT, host);
      servers.push(s);
    }
    timer = setTimeout(() => finish(reject, new Error('no reply from WordPress.com within 5 minutes')), timeoutMs);
  });
}

async function main() {
  const site = arg('site', DEFAULTS.site);
  const repo = arg('repo', DEFAULTS.repo);
  const scope = arg('scope', DEFAULTS.scope);
  const save = !process.argv.includes('--no-save');

  const clientId = arg('client-id') || await ask('WordPress app Client ID: ');
  const clientSecret = await ask('WordPress app Client Secret (typed hidden, press Enter): ', { hidden: true });
  process.stdout.write('\n');
  if (!clientId || !clientSecret) throw new Error('both the Client ID and the Client Secret are needed');

  const state = randomBytes(16).toString('hex');
  const url = authorizeUrl({ clientId, state, site, scope });
  const callback = waitForCallback(state);
  console.log(`Opening WordPress.com to approve access to ${site}${scope ? ` (scope: ${scope})` : ''}.`);
  console.log(`If no browser opens, visit:\n  ${url}`);
  if (process.platform === 'darwin') spawnSync('open', [url]);
  const code = await callback;

  const { token, blogUrl } = await exchangeCode({ clientId, clientSecret, code });
  if (blogUrl && new URL(blogUrl).host !== site) throw new Error(`the token is for ${new URL(blogUrl).host}, not ${site}; start again and pick ${site}`);
  const views = await fetchViews({ site, token });
  console.log(`WordPress.com Stats read OK: ${views.size} post(s) have views so far.`);

  if (!save) { console.log('--no-save: the token was not stored anywhere.'); return; }
  const r = spawnSync('gh', ['secret', 'set', 'WP_STATS_TOKEN', '--repo', repo], { input: token, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error('gh secret set failed. Is the GitHub CLI signed in (gh auth status) with access to the repo?');
  console.log(`Saved as the GitHub Actions secret WP_STATS_TOKEN on ${repo}. Next: tell Claude "token set".`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`Stopped: ${e.message}`); process.exit(1); });
}
