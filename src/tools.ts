// MCP tool registration. All tools are read-only and fetch live from WHOOP;
// nothing is persisted (WHOOP API Terms: no databases / permanent copies).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { dailySeries, LIMITS, RangeError_, sleepDetail, weeklySummary, workoutDetail } from "./queries";
import { ReauthRequired } from "./tokens";
import { round } from "./transform";
import { BudgetExceeded, type WhoopClient, WhoopError } from "./whoop-client";

const date = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
	.describe("Local calendar date, YYYY-MM-DD");

const range = { start_date: date.describe("First day, inclusive (YYYY-MM-DD)"), end_date: date.describe("Last day, inclusive (YYYY-MM-DD)") };

const READ_ONLY = { readOnlyHint: true, openWorldHint: true, idempotentHint: true, destructiveHint: false } as const;

const NOTE =
	"Data is live from the official WHOOP API for the connected member. Values are null when WHOOP has not scored that day (PENDING_SCORE/UNSCORABLE) or the strap had no data; never fill gaps with estimates.";

function ok(payload: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
}

function fail(e: unknown) {
	let msg: string;
	if (e instanceof ReauthRequired || (e instanceof WhoopError && e.reauth)) msg = new ReauthRequired().message;
	else if (e instanceof RangeError_ || e instanceof WhoopError || e instanceof BudgetExceeded) msg = e.message;
	else {
		console.log(JSON.stringify({ evt: "tool_error", name: (e as Error)?.name }));
		msg = "Unexpected error talking to WHOOP; try again.";
	}
	return { isError: true, content: [{ type: "text" as const, text: msg }] };
}

export function registerTools(server: McpServer, client: () => Promise<WhoopClient>) {
	const run =
		<A>(fn: (api: WhoopClient, args: A) => Promise<unknown>) =>
		async (args: A) => {
			try {
				return ok(await fn(await client(), args));
			} catch (e) {
				return fail(e);
			}
		};

	server.registerTool(
		"whoop_profile",
		{
			title: "WHOOP profile",
			description: "The connected member's WHOOP profile and body measurements (height, weight, WHOOP-calculated max heart rate).",
			inputSchema: {},
			annotations: READ_ONLY,
		},
		run(async (api) => {
			const [p, b] = await Promise.all([api.profile(), api.body()]);
			return {
				firstName: p.first_name,
				heightIn: round(b.height_meter * 39.3701, 1),
				weightLb: round(b.weight_kilogram * 2.20462, 1),
				maxHr: b.max_heart_rate,
			};
		}),
	);

	server.registerTool(
		"whoop_daily_series",
		{
			title: "WHOOP daily series",
			description: `One compact row per local day: recovery %, HRV (ms), resting HR, SpO2, skin temp, sleep hours (asleep) and in bed, sleep performance/efficiency, nap hours, day strain, kcal, avg HR, steps, workout count. Best tool for trends, correlations and charts. Max ${LIMITS.seriesDays} days per call; for longer history call it repeatedly over consecutive ranges. ${NOTE}`,
			inputSchema: range,
			annotations: READ_ONLY,
		},
		run(async (api, a: { start_date: string; end_date: string }) => {
			const { workoutRecords: _w, ...rest } = await dailySeries(api, a.start_date, a.end_date);
			return rest;
		}),
	);

	server.registerTool(
		"whoop_sleep",
		{
			title: "WHOOP sleep detail",
			description: `Every sleep and nap with bedtime/wake (local), hours asleep/in bed/awake, light/deep(SWS)/REM hours, disturbances, sleep need, performance/efficiency/consistency %, respiratory rate. Dated by wake-up day. Max ${LIMITS.detailDays} days. ${NOTE}`,
			inputSchema: range,
			annotations: READ_ONLY,
		},
		run((api, a: { start_date: string; end_date: string }) => sleepDetail(api, a.start_date, a.end_date)),
	);

	server.registerTool(
		"whoop_workouts",
		{
			title: "WHOOP workouts",
			description: `Every WHOOP-tracked workout: date, local start time, sport name, category (run/bike/swim/strength/walk_hike/mobility/other), duration, strain, avg/max HR, kcal, distance (mi) and elevation gain (ft) when recorded, HR-zone minutes z0-z5. Max ${LIMITS.detailDays} days. ${NOTE}`,
			inputSchema: range,
			annotations: READ_ONLY,
		},
		run((api, a: { start_date: string; end_date: string }) => workoutDetail(api, a.start_date, a.end_date)),
	);

	server.registerTool(
		"whoop_weekly_summary",
		{
			title: "WHOOP weekly summary",
			description: `Training-check-in summary for a period (max ${LIMITS.summaryDays} days): recovery avg/min/max and green/yellow/red day counts, HRV and resting HR vs a trailing baseline (default 28 days before the period) with days of resting HR >=5 bpm above baseline, sleep average vs target and nights below it, daily strain, all workouts with per-category totals, and plain-language flags. ${NOTE}`,
			inputSchema: {
				...range,
				baseline_days: z.number().int().min(7).max(LIMITS.baselineDays).default(28).describe("Days before start_date used as the baseline"),
				sleep_target_h: z.number().min(4).max(12).default(7.5).describe("Nightly sleep target in hours"),
			},
			annotations: READ_ONLY,
		},
		run(
			(
				api,
				a: { start_date: string; end_date: string; baseline_days?: number; sleep_target_h?: number },
			) =>
				weeklySummary(api, a.start_date, a.end_date, {
					baselineDays: a.baseline_days ?? 28,
					sleepTargetH: a.sleep_target_h ?? 7.5,
				}),
		),
	);
}
