#!/usr/bin/env node
// One-command setup: log in to Cloudflare, deploy, then store your WHOOP app
// credentials as Worker secrets. Safe to re-run; each step is skipped when done.
// Secrets are read with hidden input and piped straight to Wrangler; nothing is written to disk.

import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";

const SCOPES = ["account:read", "user:read", "workers:write", "workers_kv:write", "workers_scripts:write", "workers_tail:read"];

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const step = (n, s) => console.log(`\n${bold(`${n}.`)} ${bold(s)}`);

function wrangler(args, opts = {}) {
	return spawnSync("npx", ["wrangler", ...args], { encoding: "utf8", ...opts });
}

function ask(question, { hidden = false } = {}) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
		if (hidden) {
			rl._writeToOutput = (s) => {
				if (s.includes(question)) rl.output.write(s);
				else rl.output.write("*".repeat(s.length ? 1 : 0));
			};
		}
		rl.question(question, (answer) => {
			rl.close();
			if (hidden) process.stdout.write("\n");
			resolve(answer.trim());
		});
	});
}

function putSecret(name, value) {
	return new Promise((resolve, reject) => {
		const p = spawn("npx", ["wrangler", "secret", "put", name], { stdio: ["pipe", "ignore", "inherit"] });
		p.stdin.end(value);
		p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`wrangler secret put ${name} failed`))));
	});
}

function existingSecrets() {
	const r = wrangler(["secret", "list", "--format", "json"]);
	try {
		return new Set(JSON.parse(r.stdout).map((s) => s.name));
	} catch {
		return new Set();
	}
}

async function main() {
	console.log(bold("WHOOP connector for Claude: setup"));

	step(1, "Cloudflare login");
	if (/You are logged in/.test(wrangler(["whoami"]).stdout ?? "")) console.log("Already logged in.");
	else {
		console.log("A browser window will open. Approve Wrangler (only Workers + KV permissions are requested).");
		const r = spawnSync("npx", ["wrangler", "login", "--scopes", ...SCOPES], { stdio: "inherit" });
		if (r.status !== 0) throw new Error("Cloudflare login failed");
	}

	step(2, "Deploy the Worker");
	// Stream output live (a new account may be asked to pick a workers.dev subdomain) while capturing the URL.
	const out = await new Promise((resolve, reject) => {
		let buf = "";
		const p = spawn("npx", ["wrangler", "deploy"], { stdio: ["inherit", "pipe", "inherit"] });
		p.stdout.on("data", (d) => {
			buf += d;
			process.stdout.write(d);
		});
		p.on("exit", (code) => (code === 0 ? resolve(buf) : reject(new Error("Deploy failed (see output above)"))));
	});
	const origin = (out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) ?? [])[0];
	if (!origin) throw new Error("Could not find the workers.dev URL in the deploy output");

	const secrets = existingSecrets();
	step(3, "WHOOP developer app");
	if (secrets.has("WHOOP_CLIENT_ID") && secrets.has("WHOOP_CLIENT_SECRET")) console.log("WHOOP credentials already set.");
	else {
		console.log(`Open ${bold("https://developer-dashboard.whoop.com")} → create a team (any name) → Create App:`);
		console.log(`  Redirect URL:   ${bold(`${origin}/callback`)}`);
		console.log(`  Privacy policy: ${bold(`${origin}/privacy`)}`);
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
		console.log(`Setup complete. Connector URL: ${bold(`${origin}/mcp`)}`);
		return;
	}
	console.log(`In claude.ai → Customize → Connectors → Add connector → Add custom connector:`);
	console.log(`  Name: WHOOP    URL: ${bold(`${origin}/mcp`)}`);
	console.log("Click Connect and sign in to WHOOP. The page will show your WHOOP user id.\n");
	const owner = await ask("Paste your WHOOP user id here (or press Enter to do it later with `npm run set-owner -- <id>`): ");
	if (!owner) return console.log(`\nWhen you have it: npm run set-owner -- <id>, then click Connect again in Claude.`);
	if (!/^\d+$/.test(owner)) throw new Error("A WHOOP user id is digits only");
	await putSecret("OWNER_WHOOP_USER_ID", owner);
	console.log(`\n${bold("Done.")} Wait ~30 seconds, then click Connect again in Claude. Then try: "Summarize my WHOOP recovery and sleep for the last 7 days."`);
}

main().catch((e) => {
	console.error(`\n✘ ${e.message}`);
	process.exit(1);
});
