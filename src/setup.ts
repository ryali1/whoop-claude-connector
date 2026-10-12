// Setup helpers: the cookie-signing key fallback and the self-guiding setup page.

import type { Env } from "./env";

const COOKIE_KEY = "config:cookie_key";

/** COOKIE_ENCRYPTION_KEY if set, else a random key generated once and kept in KV. */
export async function cookieKey(env: Env): Promise<string> {
	if (env.COOKIE_ENCRYPTION_KEY) return env.COOKIE_ENCRYPTION_KEY;
	const existing = await env.OAUTH_KV.get(COOKIE_KEY);
	if (existing) return existing;
	const key = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
	await env.OAUTH_KV.put(COOKIE_KEY, key);
	return key;
}

export interface SetupState {
	clientConfigured: boolean;
	ownerConfigured: boolean;
}

export function setupState(env: Env): SetupState {
	return {
		clientConfigured: Boolean(env.WHOOP_CLIENT_ID && env.WHOOP_CLIENT_SECRET),
		ownerConfigured: Boolean(env.OWNER_WHOOP_USER_ID?.trim()),
	};
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function page(title: string, body: string) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--fg:#1a1a1a;--muted:#5c5c5c;--bg:#fff;--card:#f5f5f4;--ok:#1a7f37;--todo:#9a6700;--code:#ececea}
@media (prefers-color-scheme:dark){:root{--fg:#ededed;--muted:#a3a3a3;--bg:#141414;--card:#1f1f1f;--ok:#3fb950;--todo:#d29922;--code:#2a2a2a}}
body{font:16px/1.55 system-ui,sans-serif;max-width:44rem;margin:2.5rem auto;padding:0 16px;color:var(--fg);background:var(--bg)}
h1{font-size:1.6rem;margin:0 0 .25rem}p.sub{color:var(--muted);margin-top:0}
ol{padding-left:1.2rem}li{margin:.9rem 0}
.card{background:var(--card);border-radius:10px;padding:.8rem 1rem;margin:.4rem 0}
code{background:var(--code);padding:.1em .35em;border-radius:4px;word-break:break-all}
.ok{color:var(--ok);font-weight:600}.todo{color:var(--todo);font-weight:600}
button{font:inherit;font-size:.85rem;margin-left:.4rem;padding:.1rem .5rem;border-radius:6px;border:1px solid var(--muted);background:transparent;color:var(--fg);cursor:pointer}
</style></head><body>${body}
<script>document.querySelectorAll('button[data-copy]').forEach(b=>b.addEventListener('click',()=>{navigator.clipboard.writeText(b.dataset.copy).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1200)})}))</script>
</body></html>`;
}

const copy = (v: string) => `<code>${esc(v)}</code><button data-copy="${esc(v)}">Copy</button>`;
const mark = (done: boolean) => (done ? '<span class="ok">Done</span>' : '<span class="todo">To do</span>');

/** Landing page: a setup checklist until fully configured, then a minimal notice. Never shows secret values. */
export function setupPage(origin: string, s: SetupState): string {
	if (s.clientConfigured && s.ownerConfigured) {
		return page(
			"WHOOP connector",
			`<h1>WHOOP connector</h1><p class="sub">Private MCP server. Add it to Claude with ${copy(`${origin}/mcp`)}</p>
			 <p><a href="/privacy">Privacy</a> · Not affiliated with or endorsed by WHOOP.</p>`,
		);
	}
	return page(
		"WHOOP connector setup",
		`<h1>Finish setting up your WHOOP connector</h1>
		 <p class="sub">This page only appears until setup is complete. It never shows secret values.</p>
		 <ol>
		 <li><strong>Create a WHOOP developer app</strong> ${mark(s.clientConfigured)}
		   <div class="card">At <a href="https://developer-dashboard.whoop.com" target="_blank" rel="noopener">developer-dashboard.whoop.com</a>: create a team, then an app with<br>
		   Redirect URL: ${copy(`${origin}/callback`)}<br>
		   Privacy policy: ${copy(`${origin}/privacy`)}<br>
		   Scopes: tick all six <code>read:*</code> scopes.</div></li>
		 <li><strong>Give this server the app's credentials</strong> ${mark(s.clientConfigured)}
		   <div class="card">Run <code>npm run setup</code> again, or in the Cloudflare dashboard open Workers &amp; Pages → this worker → Settings → Variables and Secrets and add secrets
		   <code>WHOOP_CLIENT_ID</code> and <code>WHOOP_CLIENT_SECRET</code>.</div></li>
		 <li><strong>Add the connector in Claude</strong>
		   <div class="card">claude.ai → Customize → Connectors → Add connector → Add custom connector<br>URL: ${copy(`${origin}/mcp`)}<br>
		   Click Connect and sign in to WHOOP. The first time, you'll see your WHOOP user id.</div></li>
		 <li><strong>Lock it to you</strong> ${mark(s.ownerConfigured)}
		   <div class="card">Run <code>npm run set-owner -- &lt;your WHOOP user id&gt;</code> (or add secret <code>OWNER_WHOOP_USER_ID</code> in the dashboard), then click Connect again in Claude.</div></li>
		 </ol>
		 <p><a href="/privacy">Privacy</a> · Not affiliated with or endorsed by WHOOP.</p>`,
	);
}
