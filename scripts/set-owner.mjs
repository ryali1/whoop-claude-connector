#!/usr/bin/env node
// Usage: npm run set-owner -- <WHOOP user id>
// Locks the connector to one WHOOP account. Until this is set, nobody can connect.

import { spawn } from "node:child_process";

const id = (process.argv[2] ?? "").trim();
if (!/^\d+$/.test(id)) {
	console.error("Usage: npm run set-owner -- <WHOOP user id>   (digits only; shown after your first Connect in Claude)");
	process.exit(1);
}
const p = spawn("npx", ["wrangler", "secret", "put", "OWNER_WHOOP_USER_ID"], { stdio: ["pipe", "inherit", "inherit"] });
p.stdin.end(id);
p.on("exit", (code) => {
	if (code === 0) console.log("Owner set. Click Connect again in Claude.");
	process.exit(code ?? 1);
});
