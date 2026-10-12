#!/usr/bin/env node
// `npm run deploy`: deploy (first run creates the KV namespace automatically), save the URL,
// and print the exact values for the WHOOP developer app form.

import { bold, deploy, isLoggedIn, LOGIN_COMMAND, waitForServer, whoopFormValues } from "./lib.mjs";

if (!isLoggedIn()) {
	console.error(`Not logged in to Cloudflare. Run \`${LOGIN_COMMAND}\` (or \`npm run setup\`) first.`);
	process.exit(1);
}
try {
	const url = await deploy();
	await waitForServer(url, () => true, { stable: 2, label: "the new Worker to come online" });
	const f = whoopFormValues(url);
	console.log(`\n${bold("Deployed:")} ${url}`);
	console.log(`WHOOP app form (${f.dashboard}):`);
	console.log(`  Redirect URL:   ${f.redirectUrl}`);
	console.log(`  Privacy policy: ${f.privacyPolicyUrl}`);
	console.log(`  Scopes:         ${f.scopes.join(", ")}`);
	console.log(`Claude connector URL: ${url}/mcp`);
} catch (e) {
	console.error(`✘ ${e.message}`);
	if (/workers\.dev URL/.test(e.message))
		console.error("This Cloudflare account has no workers.dev subdomain yet: in the Cloudflare dashboard open Workers & Pages, choose a subdomain, then run `npm run deploy` again.");
	process.exit(1);
}
