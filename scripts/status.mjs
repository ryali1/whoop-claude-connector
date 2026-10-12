#!/usr/bin/env node
// Machine-readable setup status for humans and coding agents: `npm run status`.
// Prints JSON only. Never prints secret values (only whether each secret exists).

import { isLoggedIn, LOGIN_COMMAND, readState, SECRET_NAMES, secretNames, serverStatus, whoopFormValues, workerName } from "./lib.mjs";

const out = { workerName: workerName(), cloudflareLoggedIn: false, workerUrl: null, deployed: false, secrets: {}, server: null, nextStep: "", agentAction: null, humanAction: null };

out.cloudflareLoggedIn = isLoggedIn();
const { url } = readState();
out.workerUrl = url ?? null;

if (out.cloudflareLoggedIn && url) {
	// Sample a few times: right after a deploy or secret change, different Cloudflare locations can disagree.
	// Report the pessimistic view (a flag is true only if every read says so).
	const reads = [];
	for (let i = 0; i < 3; i++) {
		reads.push(await serverStatus(url));
		if (i < 2) await new Promise((r) => setTimeout(r, 1000));
	}
	const live = reads.filter(Boolean);
	out.deployed = live.length > 0;
	if (out.deployed)
		out.server = {
			clientConfigured: live.length === reads.length && live.every((r) => r.clientConfigured),
			ownerConfigured: live.length === reads.length && live.every((r) => r.ownerConfigured),
			consistent: live.length === reads.length && live.every((r) => JSON.stringify(r) === JSON.stringify(live[0])),
		};
	const names = secretNames();
	for (const n of SECRET_NAMES) out.secrets[n] = names.has(n);
}

const s = out.secrets;
const wait = (what) => {
	out.nextStep = "wait_for_propagation";
	out.humanAction = null;
	out.agentAction = `${what} Cloudflare is still rolling it out (usually under a minute). Run \`npm run status\` again in ~10 seconds; don't redo the previous step.`;
};
if (!out.cloudflareLoggedIn) {
	out.nextStep = "login";
	out.humanAction = `Run \`${LOGIN_COMMAND}\` and click Allow in the browser (add --browser=false to get a URL instead). A free Cloudflare account is needed: https://dash.cloudflare.com/sign-up`;
} else if (!url) {
	out.nextStep = "deploy";
	out.agentAction = "Run `npm run deploy`.";
} else if (!out.deployed) {
	wait("The Worker was deployed but isn't answering yet. If this lasts more than ~2 minutes, run `npm run deploy` again.");
} else if (!s.WHOOP_CLIENT_ID || !s.WHOOP_CLIENT_SECRET) {
	out.nextStep = "whoop_app";
	out.whoopForm = whoopFormValues(url);
	out.humanAction =
		"Create a WHOOP developer app with the values in whoopForm (create a team first if asked). Then copy the Client ID and run `pbpaste | npm run set-secret -- WHOOP_CLIENT_ID`; copy the Client Secret and run `pbpaste | npm run set-secret -- WHOOP_CLIENT_SECRET`. (Or run `npm run set-secret -- <NAME>` in your own terminal for a hidden prompt.)";
} else if (!out.server.clientConfigured) {
	wait("The WHOOP credentials are saved.");
} else if (!s.OWNER_WHOOP_USER_ID) {
	out.nextStep = "connect_claude_first_time";
	out.connectorUrl = `${url}/mcp`;
	out.humanAction = `In claude.ai: Customize -> Connectors -> Add connector -> Add custom connector. Name WHOOP, URL ${url}/mcp. Click Connect, approve, and sign in to WHOOP. The "Almost done" page shows your WHOOP user id; share it (it's not secret) so \`npm run set-owner -- <id>\` can be run.`;
} else if (!out.server.ownerConfigured) {
	wait("The owner is saved.");
} else {
	out.nextStep = "done";
	out.connectorUrl = `${url}/mcp`;
	out.humanAction = `Click Connect on the WHOOP connector in claude.ai (it should then say Connected). Try: "Summarize my WHOOP recovery and sleep for the last 7 days." Also turn off claude.ai Settings -> Privacy -> "Help improve Claude" (WHOOP's terms bar training AI on WHOOP data).`;
}

console.log(JSON.stringify(out, null, 2));
