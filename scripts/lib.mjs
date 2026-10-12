// Shared helpers for the setup scripts. No dependencies beyond Node.
// Local state (worker name + URL, never secrets) lives in .whoop-connector.json (gitignored).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";

export const STATE_FILE = ".whoop-connector.json";
export const SECRET_NAMES = ["WHOOP_CLIENT_ID", "WHOOP_CLIENT_SECRET", "OWNER_WHOOP_USER_ID"];
export const LOGIN_SCOPES = [
	"account:read",
	"user:read",
	"workers:write",
	"workers_kv:write",
	"workers_scripts:write",
	"workers_tail:read",
];

export const bold = (s) => `\x1b[1m${s}\x1b[0m`;
export const LOGIN_COMMAND = `npx wrangler login --scopes ${LOGIN_SCOPES.join(" ")}`;

export function readState() {
	try {
		return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
	} catch {
		return {};
	}
}

export function writeState(patch) {
	writeFileSync(STATE_FILE, `${JSON.stringify({ ...readState(), ...patch }, null, 2)}\n`);
}

/** Worker name: WORKER_NAME env > saved state > wrangler.jsonc default. */
export function workerName() {
	return process.env.WORKER_NAME || readState().name || "whoop-mcp";
}

const nameArgs = () => ["--name", workerName()];

export function wrangler(args, opts = {}) {
	return spawnSync("npx", ["wrangler", ...args], { encoding: "utf8", ...opts });
}

export function isLoggedIn() {
	return /You are logged in/.test(wrangler(["whoami"]).stdout ?? "");
}

export function login() {
	const r = spawnSync("npx", ["wrangler", "login", "--scopes", ...LOGIN_SCOPES], { stdio: "inherit" });
	if (r.status !== 0) throw new Error("Cloudflare login failed");
}

/** Deploys, streaming output live (a new account may be asked to pick a workers.dev subdomain). Returns the URL. */
export async function deploy() {
	const out = await new Promise((resolve, reject) => {
		let buf = "";
		const p = spawn("npx", ["wrangler", "deploy", ...nameArgs()], { stdio: ["inherit", "pipe", "inherit"] });
		p.stdout.on("data", (d) => {
			buf += d;
			process.stdout.write(d);
		});
		p.on("exit", (code) => (code === 0 ? resolve(buf) : reject(new Error("Deploy failed (see output above)"))));
	});
	const url = (out.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/) ?? [])[0];
	if (!url) throw new Error("Deployed, but could not find the workers.dev URL in the output");
	writeState({ name: workerName(), url });
	return url;
}

export function secretNames() {
	const r = wrangler(["secret", "list", "--format", "json", ...nameArgs()]);
	try {
		return new Set(JSON.parse(r.stdout).map((s) => s.name));
	} catch {
		return new Set();
	}
}

/** Pipes a value to `wrangler secret put` via stdin. The value is never printed or written to disk. */
export function putSecret(name, value) {
	if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret ${name}; expected one of ${SECRET_NAMES.join(", ")}`);
	return new Promise((resolve, reject) => {
		const p = spawn("npx", ["wrangler", "secret", "put", name, ...nameArgs()], { stdio: ["pipe", "ignore", "inherit"] });
		p.stdin.end(value);
		p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Saving ${name} failed`))));
	});
}

export function ask(question, { hidden = false } = {}) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
		if (hidden) rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : s ? "*" : "");
		rl.question(question, (answer) => {
			rl.close();
			if (hidden) process.stdout.write("\n");
			resolve(answer.trim());
		});
	});
}

export async function readStdin() {
	let data = "";
	for await (const chunk of process.stdin) data += chunk;
	return data.trim();
}

/** Reads the Worker's /status.json (booleans only). Returns null when unreachable. */
export async function serverStatus(url) {
	try {
		const res = await fetch(`${url}/status.json`, { headers: { "cache-control": "no-cache" } });
		return res.ok ? await res.json() : null;
	} catch {
		return null;
	}
}

/**
 * Polls /status.json until `ok(status)` holds for `stable` consecutive reads. New deploys and secrets
 * take a few seconds to reach every Cloudflare location, and different requests can see different versions.
 */
export async function waitForServer(url, ok, { stable = 4, timeoutMs = 120_000, label = "the server" } = {}) {
	const start = Date.now();
	let streak = 0;
	process.stdout.write(`Waiting for ${label}`);
	while (Date.now() - start < timeoutMs) {
		const s = await serverStatus(url);
		streak = s && ok(s) ? streak + 1 : 0;
		if (streak >= stable) {
			process.stdout.write(" ready.\n");
			return true;
		}
		process.stdout.write(".");
		await new Promise((r) => setTimeout(r, 2000));
	}
	process.stdout.write(" timed out (it may still finish; run `npm run status`).\n");
	return false;
}

export function whoopFormValues(url) {
	return {
		dashboard: "https://developer-dashboard.whoop.com",
		redirectUrl: `${url}/callback`,
		privacyPolicyUrl: `${url}/privacy`,
		scopes: ["read:recovery", "read:cycles", "read:sleep", "read:workout", "read:profile", "read:body_measurement"],
	};
}
