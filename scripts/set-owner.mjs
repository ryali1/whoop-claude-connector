#!/usr/bin/env node
// `npm run set-owner -- <WHOOP user id>`: lock the connector to one WHOOP account.
// Until this is set, nobody can connect. The id is shown after your first Connect in Claude.

import { putSecret, readState, waitForServer } from "./lib.mjs";

const id = (process.argv[2] ?? "").trim();
if (!/^\d+$/.test(id)) {
	console.error("Usage: npm run set-owner -- <WHOOP user id>   (digits only; shown after your first Connect in Claude)");
	process.exit(1);
}
try {
	await putSecret("OWNER_WHOOP_USER_ID", id);
	console.log("Owner saved.");
	const { url } = readState();
	if (url) await waitForServer(url, (s) => s.ownerConfigured, { label: "Cloudflare to apply the owner" });
	console.log("Now click Connect on the WHOOP connector in Claude.");
} catch (e) {
	console.error(`✘ ${e.message}`);
	process.exit(1);
}
