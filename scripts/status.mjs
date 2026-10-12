#!/usr/bin/env node
// Machine-readable setup status for humans and coding agents: `npm run status`.
// Prints JSON only. Never prints secret values (only whether each secret exists).

import { isLoggedIn, readState, SECRET_NAMES, secretNames, whoopFormValues, workerName } from "./lib.mjs";

const out = { workerName: workerName(), cloudflareLoggedIn: false, workerUrl: null, deployed: false, secrets: {}, server: null, nextStep: "", humanAction: null };

out.cloudflareLoggedIn = isLoggedIn();
const { url } = readState();
out.workerUrl = url ?? null;

if (out.cloudflareLoggedIn && url) {
	try {
		const res = await fetch(`${url}/status.json`);
		if (res.ok) {
			out.deployed = true;
			out.server = await res.json();
		}
	} catch {
		// not reachable yet
	}
	const names = secretNames();
	for (const n of SECRET_NAMES) out.secrets[n] = names.has(n);
}

const s = out.secrets;
if (!out.cloudflareLoggedIn) {
	out.nextStep = "login";
	out.humanAction = "Run `npx wrangler login` (or `npm run setup`) and approve in the browser. A free Cloudflare account is needed: https://dash.cloudflare.com/sign-up";
} else if (!out.deployed) {
	out.nextStep = "deploy";
	out.humanAction = null; // agent can run `npm run deploy`
} else if (!s.WHOOP_CLIENT_ID || !s.WHOOP_CLIENT_SECRET) {
	out.nextStep = "whoop_app";
	out.whoopForm = whoopFormValues(url);
	out.humanAction =
		"Create a WHOOP developer app with the values in whoopForm (create a team first if asked), then provide the Client ID and Client Secret. Safest: copy each to the clipboard and run `pbpaste | npm run set-secret -- WHOOP_CLIENT_ID` (then the same for WHOOP_CLIENT_SECRET), or run `npm run set-secret -- WHOOP_CLIENT_SECRET` yourself for hidden input.";
} else if (!s.OWNER_WHOOP_USER_ID) {
	out.nextStep = "connect_claude_first_time";
	out.connectorUrl = `${url}/mcp`;
	out.humanAction = `In claude.ai: Customize -> Connectors -> Add connector -> Add custom connector. Name WHOOP, URL ${url}/mcp. Click Connect and sign in to WHOOP. The page then shows your WHOOP user id; run \`npm run set-owner -- <id>\`.`;
} else if (out.server && !out.server.ownerConfigured) {
	out.nextStep = "wait_for_secret_propagation";
	out.humanAction = "Secrets were just set; Cloudflare takes ~30 s to apply them. Run `npm run status` again shortly.";
} else {
	out.nextStep = "done";
	out.connectorUrl = `${url}/mcp`;
	out.humanAction = `If Claude isn't connected yet, click Connect on the WHOOP connector in claude.ai (wait ~30 s after set-owner). Then try: "Summarize my WHOOP recovery and sleep for the last 7 days."`;
}

console.log(JSON.stringify(out, null, 2));
