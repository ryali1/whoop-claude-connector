# WHOOP connector for Claude

Let Claude read **your own** WHOOP data (recovery, HRV, resting heart rate, sleep, strain and workouts) through the
**official WHOOP API**, so you can ask things like:

- "How did my sleep this week compare to the last month?"
- "Plot my HRV and resting heart rate since August."
- "Which of my long runs left me in the red the next day?"
- "Write my Sunday training check-in from my WHOOP data."

It's a small server you host yourself on Cloudflare's **free** plan. It works as a custom connector in **claude.ai** (chats,
projects and scheduled tasks), and also in Claude Desktop and Claude Code. Setup takes about 10 minutes.

> Not affiliated with or endorsed by WHOOP. You need a WHOOP membership.

## What you need
- A WHOOP membership
- A free Cloudflare account (https://dash.cloudflare.com/sign-up)
- Node.js 22+ installed (22.18+ / 24.11+ avoids install warnings)
- A Claude plan that supports custom connectors

## Setup with a coding agent (easiest)
Open this folder in Claude Code, Codex, Cursor or any coding agent and say:

> Set up the WHOOP connector in this repo for me by following AGENTS.md.

(In Claude Code you can also type `/setup-whoop`.) The agent runs the commands and checks progress with `npm run status`.
It tells you exactly what to click in the three places that need you: Cloudflare login, the WHOOP developer form, and
adding the connector in claude.ai. Your WHOOP secret goes straight from your clipboard to Cloudflare and never appears in
the chat.

## Setup yourself (one command)
```sh
git clone https://github.com/ryali1/whoop-claude-connector.git
cd whoop-claude-connector
npm install --ignore-scripts
npm run setup
```
`npm run setup` walks you through it:
1. **Cloudflare login** in your browser. Wrangler requests only Workers and KV permissions.
2. **Deploy.** It prints your server's address, e.g. `https://whoop-mcp.<you>.workers.dev`.
3. **WHOOP app.** It tells you exactly what to paste at [developer-dashboard.whoop.com](https://developer-dashboard.whoop.com):
   a redirect URL, a privacy URL, and the six read scopes. You paste back the Client ID and Secret (hidden input). They go
   straight into Cloudflare's encrypted secrets and are never written to disk.
4. **Connect Claude.** In claude.ai: **Customize → Connectors → Add connector → Add custom connector**, name `WHOOP`, URL
   `https://whoop-mcp.<you>.workers.dev/mcp` → **Connect**. Sign in to WHOOP. The first time, the page shows your
   **WHOOP user id**. Paste it into the setup prompt (or run `npm run set-owner -- <id>`), then click **Connect** again.

Lost? Open your server's address in a browser. Until setup is finished, it shows a checklist with copy buttons for every URL.

Step-by-step commands (what the agent uses; handy if you want to go step by step yourself):

| Command | Does |
|---|---|
| `npm run status` | JSON: what's done and the next step (never prints secrets) |
| `npm run deploy` | Deploy and print the WHOOP form values |
| `npm run set-secret -- WHOOP_CLIENT_ID` | Store a secret from a hidden prompt, or piped: `pbpaste \| npm run set-secret -- WHOOP_CLIENT_SECRET` |
| `npm run set-owner -- <id>` | Lock the connector to your WHOOP account |

## Tools Claude gets (all read-only)
| Tool | Returns | Max range per call |
|---|---|---|
| `whoop_profile` | first name, height, weight, WHOOP max heart rate | n/a |
| `whoop_daily_series` | one row per day: recovery %, HRV, resting HR, SpO2, skin temp, sleep hours, sleep performance/efficiency, naps, day strain, calories, avg HR, steps, workout count | 180 days |
| `whoop_sleep` | every sleep and nap: bedtime/wake, light/deep/REM, disturbances, sleep need, performance/efficiency/consistency, respiratory rate | 92 days |
| `whoop_workouts` | sport, category (run/bike/swim/strength/walk_hike/…), duration, strain, avg/max HR, calories, distance (mi), elevation (ft), minutes per HR zone | 92 days |
| `whoop_weekly_summary` | recovery green/yellow/red days, HRV and resting HR vs your trailing baseline, days with resting HR 5+ bpm high, sleep vs target, strain, workouts by category, plain-language flags | 31 days (+ up to 60-day baseline) |

Dates are your local calendar days. Sleep and recovery are dated by the morning you woke up. Days WHOOP hasn't scored
come back empty, never estimated. For longer history, Claude calls `whoop_daily_series` several times (e.g. one call per
quarter).

### Example: weekly training check-in (claude.ai scheduled task)
> Each Sunday: call `whoop_weekly_summary` for the last 7 days (28-day baseline, 7.5 h sleep target) and
> `whoop_daily_series` for the 3 weeks before. Report 2–3 wins, anything to watch with the numbers (red days, resting HR
> above baseline, short sleep), and 1–3 adjustments for next week. Never invent numbers; if WHOOP has no data for a day,
> say so.

## Privacy and WHOOP's API terms (why it's built this way)
- **Official API only**, using WHOOP's OAuth sign-in. No password scraping, no unofficial endpoints.
- **Your data isn't stored.** It's fetched live when Claude asks and returned to your own Claude session. The server keeps
  only your WHOOP sign-in tokens, encrypted at rest in Cloudflare. Logs record status codes, never health data.
  (WHOOP's terms prohibit building databases or permanent copies of WHOOP data.)
- **Only you can connect.** Your WHOOP user id is the allowlist, and it fails closed until it's set. Anyone else who signs in
  is refused and their grant is revoked.
- **Model training:** WHOOP's terms bar using WHOOP data to train AI models. In claude.ai, turn off
  **Settings → Privacy → "Help improve Claude"**.
- **Personal use.** This is for looking at your own data, not for giving medical advice to others.
- **Keep your Client Secret private.** It lives only in Cloudflare secrets. Never commit it.
- WHOOP's new apps start on a Sandbox tier (up to 10 members, no review needed), which is plenty for one person.

## What's not available
WHOOP's public API exposes recovery, sleep, cycles/strain, workouts, profile and body measurements. It does **not**
expose Advanced Labs (blood test) results, the Journal, Stress Monitor, VO2 max, Healthspan/WHOOP Age, or raw
heart-rate streams. For lab results, download the PDF from the WHOOP app and add it to your Claude project.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Opening the server URL shows the setup checklist | Finish the steps marked "To do" |
| "Almost done … your WHOOP user id is …" | `npm run set-owner -- <id>`, then Connect again |
| Claude says WHOOP isn't connected / authorization expired | claude.ai → Connectors → WHOOP → Disconnect, then Connect |
| "range is N days; max …" | Ask for a shorter range; Claude can split long ranges |
| Right after setting a secret, Connect bounces back to the setup page | New secrets take ~30 seconds to reach every Cloudflare location; wait and retry |
| "WHOOP rate limit hit" | Wait a minute (WHOOP allows 100 requests/min) |

Live logs: `npx wrangler tail`.

## Uninstall
claude.ai → Connectors → WHOOP → Remove · `npx wrangler delete` · `npx wrangler kv namespace list`, then delete the
`whoop-mcp-oauth-kv` namespace (`npx wrangler kv namespace delete --namespace-id <id>`) · delete the app in the WHOOP
developer dashboard.

## Develop
```sh
npm install --ignore-scripts   # skips an optional native image module Wrangler's local simulator doesn't need
npm test                       # unit + MCP SDK tests, no WHOOP account needed
npm run type-check
cp .dev.vars.example .dev.vars && npm run dev   # local server on :8788
```
Built on Cloudflare's `agents` + `@cloudflare/workers-oauth-provider` remote-MCP pattern. `@modelcontextprotocol/sdk` is
pinned to 1.31.0 via `overrides` (GHSA-6qxp-vccf-f47h).
The deployed Worker's dependencies audit clean (`npm audit --omit=dev`). The remaining `npm audit` advisories are in local dev
tooling (Wrangler's local simulator), which never ships. Don't run `npm audit fix --force`.

## License
MIT. See [LICENSE](LICENSE). `src/workers-oauth-utils.ts` is adapted from Cloudflare's MIT-licensed
[cloudflare/ai](https://github.com/cloudflare/ai) demos.
