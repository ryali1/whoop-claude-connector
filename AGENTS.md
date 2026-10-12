# AGENTS.md: setting up the WHOOP connector for your user

You are a coding agent (Claude Code, Codex, Cursor, …) helping **one person** set up their **own** copy of this connector so
their Claude can read their WHOOP data. Total time is about 10–15 minutes, and most of it is the human clicking through 3
web pages. Your job: run the commands, check state after every step, give the human exact copy-paste values, and keep
their secrets out of your output.

## Ground rules (read first)
1. **Never print, echo, log or commit a secret.** That covers the WHOOP Client Secret, the Client ID, and anything from
   `.dev.vars`. Store secrets only via `npm run set-secret` (stdin or hidden prompt). Don't put a secret on a command
   line (`echo <secret> | …` lands in shell history and in your transcript). If the user pastes a secret into chat,
   store it and tell them to delete the message if their tool allows it. Best options, in order:
   - The human runs `npm run set-secret -- NAME` themselves for a hidden prompt. In Claude Code they can type
     `! npm run set-secret -- NAME` to run it in the session.
   - They copy the value and you run `pbpaste | npm run set-secret -- NAME` (macOS),
     `powershell -c Get-Clipboard | npm run set-secret -- NAME` (Windows) or `xclip -o -sel clip | npm run set-secret -- NAME`
     (Linux). The value goes clipboard → Cloudflare and never appears in your output.
2. **Don't automate the human steps** with browser automation unless the user explicitly asks: Cloudflare login,
   creating the WHOOP developer app, adding the connector in claude.ai, and signing in to WHOOP.
3. **Don't edit `wrangler.jsonc` bindings or `src/`** to "fix" setup problems. Setup needs no code changes.
4. **Use only the official WHOOP API.** This project is built to follow WHOOP's API terms (no unofficial endpoints,
   no storing WHOOP data). Don't add caching, databases or scraping.
5. Run `npm run status` after every step. It prints JSON with `nextStep`, `agentAction` (for you) and `humanAction` (for
   the human) and never contains secrets. Trust it over your memory. If it says `wait_for_propagation`, re-run it in ~10
   seconds; **don't redo the previous step**. New deploys and secrets take up to a minute to reach every Cloudflare
   location.
6. **Don't run `npm audit fix --force`.** The deployed Worker's dependencies audit clean (`npm audit --omit=dev` → 0).
   The remaining advisories are in local dev tooling (Wrangler's local simulator: `sharp`, `undici`) that never ships,
   and `--force` would break the pinned versions.

## Prerequisites (check, don't assume)
- Node.js 22.18+ or 24.11+ (`node -v`). Wrangler needs ≥ 22. Slightly older 22/24 builds work but print `EBADENGINE`
  warnings, which are safe to ignore.
- The human has a WHOOP membership, a Claude plan with custom connectors, and a Cloudflare account (free:
  https://dash.cloudflare.com/sign-up; they can create it during login).

## Steps

### 0. Install
```sh
npm install --ignore-scripts
npm test            # optional sanity check, needs no accounts
npm run status
```
`--ignore-scripts` is intentional: it skips an optional native image module (sharp) that often fails to build and isn't
needed.

**Worker name:** the default is `whoop-mcp`. If the Cloudflare account already has a Worker with that name that isn't
this connector, use another name: prefix the **first** `npm run deploy` with `WORKER_NAME=<name>`. After that, the name
is remembered in `.whoop-connector.json` and later commands pick it up automatically.

### 1. `nextStep: "login"`: Cloudflare login (human approves in browser)
Run the command from `humanAction` (`npx wrangler login --scopes account:read user:read workers:write workers_kv:write workers_scripts:write workers_tail:read`).
It opens a browser page and the human clicks **Allow**. If your environment can't open a browser, run it with
`--browser=false` and give the human the printed URL. The login callback goes to `localhost:8976` on this machine, so the
browser must be on the same computer. The scopes are deliberately minimal (Workers + KV only).

### 2. `nextStep: "deploy"`: deploy (you can do this)
```sh
npm run deploy
```
The first deploy creates the KV namespace automatically, waits until the Worker answers, and prints the WHOOP form
values. The URL is saved to `.whoop-connector.json` (gitignored, no secrets). Run it with stdin closed
(`npm run deploy < /dev/null`) so it can't hang on a prompt. If it fails with "no workers.dev subdomain" (brand-new
accounts), the human opens the Cloudflare dashboard → **Workers & Pages**, picks a `workers.dev` subdomain, and you
re-run `npm run deploy`.

### 3. `nextStep: "whoop_app"`: WHOOP developer app (human), then store credentials
`npm run status` now includes `whoopForm`. Give the human these exact values:
- Go to https://developer-dashboard.whoop.com, sign in with their WHOOP account, and create a **team** if prompted (any
  name).
- **Create App**: any name (e.g. "My Claude connector"); contact email; **Privacy policy** = `whoopForm.privacyPolicyUrl`;
  **Redirect URL** = `whoopForm.redirectUrl`; tick **all six** scopes. No webhooks. **Create App**.
- The app page shows **Client ID** and **Client Secret**. Store each with `npm run set-secret` (see ground rule 1): the
  human copies a value, says "copied", and you run `pbpaste | npm run set-secret -- WHOOP_CLIENT_ID`; then the same for
  `WHOOP_CLIENT_SECRET`. Once both are saved, the script waits until Cloudflare has applied them (up to ~1 min).

The app starts on WHOOP's Sandbox tier (up to 10 members, no review), which is enough for personal use.

### 4. `nextStep: "connect_claude_first_time"`: connect in Claude (human), then lock to owner
Tell the human:
- claude.ai → **Customize → Connectors → Add connector → Add custom connector**
- Name `WHOOP`, URL = `connectorUrl` from status (`https://…workers.dev/mcp`) → **Add** → **Connect**
- Approve the connector's consent page, sign in to WHOOP and authorize.
- An **"Almost done"** page shows their **WHOOP user id** (digits). This is expected: the server refuses everyone until
  an owner is set, and nothing is stored yet.

Then run (the id isn't secret; the script waits until Cloudflare applies it):
```sh
npm run set-owner -- <their WHOOP user id>
```

### 5. `nextStep: "done"`: final connect + verify
Once `npm run status` says `done`, the human clicks **Connect** again on the WHOOP connector in claude.ai. It should show **Connected**.
Suggest a first prompt: *"Summarize my WHOOP recovery, HRV and sleep for the last 7 days."*

Also tell them: in claude.ai **Settings → Privacy**, turn off **"Help improve Claude"**. WHOOP's terms bar using WHOOP
data to train AI models.

## Verifying without the human
- `npm run status` → `nextStep` progresses as above. `server.clientConfigured` / `server.ownerConfigured` come from the
  live Worker.
- `curl -s -o /dev/null -w '%{http_code}\n' <url>/` → `200` (HTML setup checklist until done).
- `curl -s -o /dev/null -w '%{http_code}\n' -X POST <url>/mcp` → `401` (correct: it needs OAuth).
- Live logs: `npx wrangler tail --name <workerName>` (status codes only; the server never logs health data).

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `npm install` fails building `sharp` | Use `npm install --ignore-scripts` |
| `npm run setup` exits with code 2 | It's interactive; agents use the step scripts above |
| `EBADENGINE` warnings during install | Node is slightly older than 22.18 / 24.11; safe to ignore if `npm test` passes |
| Connect bounces to the setup checklist, or WHOOP shows a client error right after setting secrets | Propagation; wait ~30 s and retry |
| WHOOP says the redirect URI doesn't match | Redirect in the WHOOP app must equal `whoopForm.redirectUrl` exactly (https, `/callback`, no trailing slash) |
| "Not authorized" page | Signed in with a different WHOOP account than `OWNER_WHOOP_USER_ID` |
| Claude says "couldn't finish connecting" | `npx wrangler tail` and retry Connect; check status codes on `/token` and `/mcp` |
| Claude says WHOOP isn't connected / authorization expired | claude.ai → Connectors → WHOOP → Disconnect, then Connect |
| `deploy` can't find the workers.dev URL | The account has no workers.dev subdomain yet; create one in the Cloudflare dashboard (Workers & Pages) and redeploy |

## Uninstall
1. claude.ai → Connectors → WHOOP → Remove.
2. `npx wrangler delete --name <workerName>` (deletes the Worker and its Durable Object storage, including the tokens).
3. `npx wrangler kv namespace list`, find `<workerName>-oauth-kv`, then
   `npx wrangler kv namespace delete --namespace-id <id>`. `wrangler delete` leaves this behind.
4. Delete the app in the WHOOP developer dashboard (this also invalidates its Client Secret).
