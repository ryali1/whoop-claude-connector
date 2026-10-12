#!/usr/bin/env node
// `npm run set-secret -- <NAME>`: store a Worker secret without it appearing on screen or in logs.
//   Interactive:  npm run set-secret -- WHOOP_CLIENT_SECRET          (hidden prompt)
//   Piped:        pbpaste | npm run set-secret -- WHOOP_CLIENT_ID    (value from stdin)

import { ask, putSecret, readState, readStdin, SECRET_NAMES, secretNames, waitForServer } from "./lib.mjs";

const name = process.argv[2];
if (!SECRET_NAMES.includes(name)) {
	console.error(`Usage: npm run set-secret -- <${SECRET_NAMES.join("|")}>`);
	process.exit(1);
}
const value = process.stdin.isTTY ? await ask(`${name} (hidden): `, { hidden: true }) : await readStdin();
if (!value) {
	console.error(`No value received for ${name}.`);
	process.exit(1);
}
if (/\s/.test(value)) {
	console.error(`${name} contains whitespace; check what was copied.`);
	process.exit(1);
}
try {
	await putSecret(name, value);
	console.log(`Saved ${name} (${value.length} characters).`);
	const { url } = readState();
	const names = secretNames();
	if (url && names.has("WHOOP_CLIENT_ID") && names.has("WHOOP_CLIENT_SECRET"))
		await waitForServer(url, (s) => s.clientConfigured, { label: "Cloudflare to apply the WHOOP credentials" });
	if (url && name === "OWNER_WHOOP_USER_ID") await waitForServer(url, (s) => s.ownerConfigured, { label: "Cloudflare to apply the owner" });
} catch (e) {
	console.error(`✘ ${e.message}`);
	process.exit(1);
}
