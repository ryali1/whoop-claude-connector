#!/usr/bin/env node
// `npm run set-secret -- <NAME>`: store a Worker secret without it appearing on screen or in logs.
//   Interactive:  npm run set-secret -- WHOOP_CLIENT_SECRET          (hidden prompt)
//   Piped:        pbpaste | npm run set-secret -- WHOOP_CLIENT_ID    (value from stdin)

import { ask, putSecret, readStdin, SECRET_NAMES } from "./lib.mjs";

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
	console.log(`Saved ${name} (${value.length} characters). Cloudflare applies new secrets within ~30 seconds.`);
} catch (e) {
	console.error(`✘ ${e.message}`);
	process.exit(1);
}
