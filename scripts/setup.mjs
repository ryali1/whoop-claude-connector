#!/usr/bin/env node
// `npm run setup`: guided, interactive setup for humans. Safe to re-run; finished steps are skipped.
// Coding agents: use `npm run status` (JSON) and the step scripts instead; see AGENTS.md.

import { ask, bold, deploy, isLoggedIn, login, putSecret, secretNames, whoopFormValues } from "./lib.mjs";

const step = (n, s) => console.log(`\n${bold(`${n}.`)} ${bold(s)}`);

async function main() {
	if (!process.stdin.isTTY) {
		console.error(
			"npm run setup needs an interactive terminal.\nCoding agents: follow AGENTS.md (npm run status -> npm run deploy -> npm run set-secret / set-owner).",
		);
		process.exit(2);
	}
	console.log(bold("WHOOP connector for Claude: setup"));

	step(1, "Cloudflare login");
	if (isLoggedIn()) console.log("Already logged in.");
	else {
		console.log("A browser window will open. Approve Wrangler (only Workers + KV permissions are requested).");
		login();
	}

	step(2, "Deploy the Worker");
	const url = await deploy();

	const secrets = secretNames();
	step(3, "WHOOP developer app");
	if (secrets.has("WHOOP_CLIENT_ID") && secrets.has("WHOOP_CLIENT_SECRET")) console.log("WHOOP credentials already set.");
	else {
		const f = whoopFormValues(url);
		console.log(`Open ${bold(f.dashboard)} → create a team (any name) → Create App:`);
		console.log(`  Redirect URL:   ${bold(f.redirectUrl)}`);
		console.log(`  Privacy policy: ${bold(f.privacyPolicyUrl)}`);
		console.log("  Scopes:         tick all six read:* boxes");
		console.log("Then copy the Client ID and Client Secret from the app page.\n");
		const id = await ask("Client ID: ");
		const secret = await ask("Client Secret (hidden): ", { hidden: true });
		if (!id || !secret) throw new Error("Both values are required; re-run `npm run setup` when you have them");
		await putSecret("WHOOP_CLIENT_ID", id);
		await putSecret("WHOOP_CLIENT_SECRET", secret);
		console.log("Saved as Worker secrets. (Cloudflare can take ~30 seconds to apply new secrets everywhere.)");
	}

	step(4, "Connect Claude");
	if (secrets.has("OWNER_WHOOP_USER_ID")) {
		console.log(`Setup complete. Connector URL: ${bold(`${url}/mcp`)}`);
		return;
	}
	console.log("In claude.ai → Customize → Connectors → Add connector → Add custom connector:");
	console.log(`  Name: WHOOP    URL: ${bold(`${url}/mcp`)}`);
	console.log("Click Connect and sign in to WHOOP. The page will show your WHOOP user id.\n");
	const owner = await ask("Paste your WHOOP user id here (or press Enter to do it later with `npm run set-owner -- <id>`): ");
	if (!owner) return console.log("\nWhen you have it: npm run set-owner -- <id>, then click Connect again in Claude.");
	if (!/^\d+$/.test(owner)) throw new Error("A WHOOP user id is digits only");
	await putSecret("OWNER_WHOOP_USER_ID", owner);
	console.log(`\n${bold("Done.")} Wait ~30 seconds, then click Connect again in Claude.`);
	console.log('Then try: "Summarize my WHOOP recovery and sleep for the last 7 days."');
}

main().catch((e) => {
	console.error(`\n✘ ${e.message}`);
	process.exit(1);
});
