import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { ReauthRequired } from "../src/tokens";
import { registerTools } from "../src/tools";
import { WhoopClient } from "../src/whoop-client";
import { days, workout } from "./fixtures";

/** A WhoopClient whose HTTP layer serves fixture pages, so tools run end to end through the MCP SDK. */
function fixtureClient() {
	const d = days(["2026-10-05", "2026-10-06", "2026-10-07"], (_, i) => ({ pct: [25, 70, 50][i], rhr: 54, hrv: 62, sleepH: 7 }));
	const routes: Record<string, unknown> = {
		"/v2/cycle": { records: d.cycles },
		"/v2/recovery": { records: d.recoveries },
		"/v2/activity/sleep": { records: d.sleeps },
		"/v2/activity/workout": { records: [workout("w1", "2026-10-06T15:00:00.000Z", "Running", 125, 21097.5)] },
		"/v2/user/profile/basic": { user_id: 42, email: "x@example.com", first_name: "Pat", last_name: "R" },
		"/v2/user/measurement/body": { height_meter: 1.78, weight_kilogram: 81, max_heart_rate: 190 },
	};
	const fetchImpl = (async (url: string) => {
		const path = new URL(url).pathname.replace("/developer", "");
		return new Response(JSON.stringify(routes[path] ?? {}), { status: routes[path] ? 200 : 404 });
	}) as typeof fetch;
	return new WhoopClient({ getAccessToken: async () => "tok" }, { fetchImpl });
}

async function connect(client: () => Promise<WhoopClient>) {
	const server = new McpServer({ name: "whoop", version: "test" });
	registerTools(server, client);
	const [a, b] = InMemoryTransport.createLinkedPair();
	const c = new Client({ name: "test", version: "1" });
	await Promise.all([server.connect(a), c.connect(b)]);
	return c;
}

const parse = (r: Awaited<ReturnType<Client["callTool"]>>) =>
	JSON.parse((r.content as { type: string; text: string }[])[0].text);

describe("MCP tools over the SDK", () => {
	it("exposes five read-only tools", async () => {
		const c = await connect(async () => fixtureClient());
		const { tools } = await c.listTools();
		expect(tools.map((t) => t.name).sort()).toEqual(
			["whoop_daily_series", "whoop_profile", "whoop_sleep", "whoop_weekly_summary", "whoop_workouts"].sort(),
		);
		for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
		const ws = tools.find((t) => t.name === "whoop_weekly_summary")!;
		expect(Object.keys(ws.inputSchema.properties ?? {})).toEqual(
			expect.arrayContaining(["start_date", "end_date", "baseline_days", "sleep_target_h"]),
		);
	});

	it("profile returns minimum-necessary fields in US units (no email)", async () => {
		const c = await connect(async () => fixtureClient());
		const p = parse(await c.callTool({ name: "whoop_profile", arguments: {} }));
		expect(p).toEqual({ firstName: "Pat", heightIn: 70.1, weightLb: 178.6, maxHr: 190 });
	});

	it("daily series and weekly summary return computed rows", async () => {
		const c = await connect(async () => fixtureClient());
		const s = parse(
			await c.callTool({ name: "whoop_daily_series", arguments: { start_date: "2026-10-05", end_date: "2026-10-07" } }),
		);
		expect(s.rows.map((r: { recoveryPct: number }) => r.recoveryPct)).toEqual([25, 70, 50]);
		expect(s).not.toHaveProperty("workoutRecords");

		const w = parse(
			await c.callTool({ name: "whoop_weekly_summary", arguments: { start_date: "2026-10-05", end_date: "2026-10-11" } }),
		);
		expect(w.recovery).toMatchObject({ red: 1, yellow: 1, green: 1 });
		expect(w.workouts.list[0]).toMatchObject({ sport: "Running", distanceMi: 13.11, date: "2026-10-06" });
	});

	it("validates dates and ranges", async () => {
		const c = await connect(async () => fixtureClient());
		const bad = await c.callTool({ name: "whoop_workouts", arguments: { start_date: "10/05/2026", end_date: "2026-10-07" } });
		expect(bad.isError).toBe(true);
		const big = await c.callTool({ name: "whoop_workouts", arguments: { start_date: "2026-01-01", end_date: "2026-10-07" } });
		expect(big.isError).toBe(true);
		expect(JSON.stringify(big.content)).toMatch(/max 92/);
	});

	it("turns auth problems into a reconnect instruction", async () => {
		const c = await connect(async () => {
			throw new ReauthRequired();
		});
		const r = await c.callTool({ name: "whoop_profile", arguments: {} });
		expect(r.isError).toBe(true);
		expect(JSON.stringify(r.content)).toMatch(/Disconnect, then Connect/);
	});
});
