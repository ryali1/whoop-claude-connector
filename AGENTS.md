# AGENTS.md: setting up the WHOOP connector for your user

You are a coding agent (Claude Code, Codex, Cursor, …) helping **one person** set up their **own** copy of this connector so
their Claude can read their WHOOP data. Total time is about 10–15 minutes, and most of it is the human clicking through 3
web pages. Your job: run the commands, check state after every step, give the human exact copy-paste values, and keep
their secrets out of your output.

## Ground rules (read first)
1. **Never print, echo, log or commit a secret.** That covers the WHOOP Client Secret, the Client ID, and anything from
   `.dev.vars`. Store secrets only via `npm run set-secret` (stdin or hidden prompt). Don't put a secret on a command
   line (`echo <secret> | …` lands in shell history and in your transcript). If the user pastes a secret into chat,
   store it and tell them to delete the message if their tool allows it. Prefer having them copy it to the clipboard
   and run `pbpaste | npm run set-secret -- NAME` (macOS) / `Get-Clipboard | npm run set-secret -- NAME` (Windows)
   / `xclip -o -sel clip | npm run set-secret -- NAME` (Linux).
2. **Don't automate the human steps** with browser automation unless the user explicitly asks: Cloudflare login,
   creating the WHOOP developer app, adding the connector in claude.ai, and signing in to WHOOP.
3. **Don't edit `wrangler.jsonc` bindings or `src/`** to "fix" setup problems. Setup needs no code changes.
4. **Use only the official WHOOP API.** This project is built to follow WHOOP's API terms (no unofficial endpoints,
   no storing WHOOP data). Don't add caching, databases or scraping.
5. Run `npm run status` after every step. It prints JSON with `nextStep` and `humanAction` and never contains secrets.
   Trust it over your memory.

## Prerequisites (check, don't assume)
- Node.js ≥ 20 (`node -v`).
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

### 1. `nextStep: "login"`: Cloudflare login (human approves in browser)
Run `npx wrangler login --scopes account:read user:read workers:write workers_kv:write workers_scripts:write workers_tail:read`.
It opens a browser page and the human clicks **Allow**. If your environment can't open a browser, run it with
`--browser=false` and give the human the printed URL. The login callback goes to `localhost:8976` on this machine, so the
browser must be on the same computer. The scopes are deliberately minimal (Workers + KV only).

### 2. `nextStep: "deploy"`: deploy (you can do this)
```sh
npm run deploy
```
The first deploy creates the KV namespace automatically. If Cloudflare asks to register a `workers.dev` subdomain (new
accounts), let the human pick one. The script prints the URL and saves it to `.whoop-connector.json` (gitignored, no
secrets). To use a different Worker name, set `WORKER_NAME=<name>` for every command.

### 3. `nextStep: "whoop_app"`: WHOOP developer app (human), then store credentials
`npm run status` now includes `whoopForm`. Give the human these exact values:
- Go to https://developer-dashboard.whoop.com, sign in with their WHOOP account, and create a **team** if prompted (any
  name).
- **Create App**: any name (e.g. "My Claude connector"); contact email; **Privacy policy** = `whoopForm.privacyPolicyUrl`;
  **Redirect URL** = `whoopForm.redirectUrl`; tick **all six** scopes. No webhooks. **Create App**.
- The app page shows **Client ID** and **Client Secret**. Have them copy each one and store it:
  ```sh
  pbpaste | npm run set-secret -- WHOOP_CLIENT_ID
  pbpaste | npm run set-secret -- WHOOP_CLIENT_SECRET
  ```
  (or run `npm run set-secret -- WHOOP_CLIENT_SECRET` in their own terminal for a hidden prompt).

The app starts on WHOOP's Sandbox tier (up to 10 members, no review), which is enough for personal use.

### 4. `nextStep: "connect_claude_first_time"`: connect in Claude (human), then lock to owner
Wait ~30 seconds after setting secrets (Cloudflare propagation), then tell the human:
- claude.ai → **Customize → Connectors → Add connector → Add custom connector**
- Name `WHOOP`, URL = `connectorUrl` from status (`https://…workers.dev/mcp`) → **Add** → **Connect**
- Approve the connector's consent page, sign in to WHOOP and authorize.
- An **"Almost done"** page shows their **WHOOP user id** (digits). This is expected: the server refuses everyone until
  an owner is set, and nothing is stored yet.

Then run (the id isn't secret):
```sh
npm run set-owner -- <their WHOOP user id>
```

### 5. `nextStep: "done"`: final connect + verify
After ~30 seconds, the human clicks **Connect** again on the WHOOP connector in claude.ai. It should show **Connected**.
Suggest a first prompt: *"Summarize my WHOOP recovery, HRV and sleep for the last 7 days."*

Also tell them: in claude.ai **Settings → Privacy**, turn off **"Help improve Claude"**. WHOOP's terms bar using WHOOP
data to train AI models.

## Verifying without the human
- `npm run status` → `nextStep` progresses as above. `server.clientConfigured` / `server.ownerConfigured` come from the
  live Worker.
- `curl -s <url>/` returns 200 (HTML setup checklist until done). `curl -s -X POST <url>/mcp` returns **401** (correct:
  it needs OAuth).
- Live logs: `npx wrangler tail --name <workerName>` (status codes only; the server never logs health data).

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `npm install` fails building `sharp` | Use `npm install --ignore-scripts` |
| `npm run setup` exits with code 2 | It's interactive; agents use the step scripts above |
| Connect bounces to the setup checklist, or WHOOP shows a client error right after setting secrets | Propagation; wait ~30 s and retry |
| WHOOP says the redirect URI doesn't match | Redirect in the WHOOP app must equal `whoopForm.redirectUrl` exactly (https, `/callback`, no trailing slash) |
| "Not authorized" page | Signed in with a different WHOOP account than `OWNER_WHOOP_USER_ID` |
| Claude says "couldn't finish connecting" | `npx wrangler tail` and retry Connect; check status codes on `/token` and `/mcp` |
| Claude says WHOOP isn't connected / authorization expired | claude.ai → Connectors → WHOOP → Disconnect, then Connect |
| `deploy` can't find the workers.dev URL | The account has no workers.dev subdomain yet; create one in the Cloudflare dashboard (Workers & Pages) and redeploy |

## Uninstall
claude.ai → Connectors → WHOOP → Remove · `npx wrangler delete --name <workerName>` · delete the app in the WHOOP developer
dashboard · optionally remove the app under connected apps in the WHOOP mobile app.
