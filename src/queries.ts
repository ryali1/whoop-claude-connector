// Date-range queries composed from WhoopClient + transform. Inputs are local
// calendar dates (YYYY-MM-DD); WHOOP is queried with a 2-day margin on each side
// and records are then assigned to local days using their own timezone offsets.

import {
	addDays,
	buildDailySeries,
	daysBetweenInclusive,
	localDate,
	normalizeSleep,
	normalizeWorkout,
	summarize,
} from "./transform";
import type { WhoopClient } from "./whoop-client";

export const LIMITS = {
	seriesDays: 180, // per call; ~4 collections x 8 pages stays under the free-plan subrequest cap
	detailDays: 92,
	summaryDays: 31,
	baselineDays: 60,
};

export class RangeError_ extends Error {}

export function validateRange(start: string, end: string, maxDays: number): void {
	if (end < start) throw new RangeError_(`end_date ${end} is before start_date ${start}`);
	const n = daysBetweenInclusive(start, end);
	if (n > maxDays)
		throw new RangeError_(
			`range is ${n} days; max ${maxDays} per call. Split it into consecutive calls (e.g. by quarter) and combine.`,
		);
}

const iso = (date: string) => `${date}T00:00:00.000Z`;
const window = (start: string, end: string) => [iso(addDays(start, -2)), iso(addDays(end, 2))] as const;
/** Pages needed for n days at ~perDay records/day, 25 per page, with slack. */
const pages = (days: number, perDay = 1.2) => Math.ceil(((days + 4) * perDay) / 25) + 1;

export async function dailySeries(api: WhoopClient, start: string, end: string) {
	validateRange(start, end, LIMITS.seriesDays);
	const [s, e] = window(start, end);
	const n = daysBetweenInclusive(start, end);
	const [cycles, recoveries, sleeps, workouts] = await Promise.all([
		api.cycles(s, e, pages(n)),
		api.recoveries(s, e, pages(n)),
		api.sleeps(s, e, pages(n, 1.5)),
		api.workouts(s, e, pages(n, 1.5)),
	]);
	const rows = buildDailySeries(start, end, {
		cycles: cycles.records,
		recoveries: recoveries.records,
		sleeps: sleeps.records,
		workouts: workouts.records,
	});
	const truncated = [cycles, recoveries, sleeps, workouts].some((c) => c.truncated);
	return { start, end, truncated, rows, workoutRecords: workouts.records };
}

export async function sleepDetail(api: WhoopClient, start: string, end: string) {
	validateRange(start, end, LIMITS.detailDays);
	const [s, e] = window(start, end);
	const res = await api.sleeps(s, e, pages(daysBetweenInclusive(start, end), 1.5));
	const sleeps = res.records
		.map(normalizeSleep)
		.filter((x) => x.date >= start && x.date <= end)
		.sort((a, b) => a.date.localeCompare(b.date));
	return { start, end, truncated: res.truncated, sleeps };
}

export async function workoutDetail(api: WhoopClient, start: string, end: string) {
	validateRange(start, end, LIMITS.detailDays);
	const [s, e] = window(start, end);
	const res = await api.workouts(s, e, pages(daysBetweenInclusive(start, end), 1.5));
	const workouts = res.records
		.map(normalizeWorkout)
		.filter((x) => x.date >= start && x.date <= end)
		.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
	return { start, end, truncated: res.truncated, workouts };
}

export async function weeklySummary(
	api: WhoopClient,
	start: string,
	end: string,
	opts: { baselineDays: number; sleepTargetH: number },
) {
	validateRange(start, end, LIMITS.summaryDays);
	if (opts.baselineDays < 7 || opts.baselineDays > LIMITS.baselineDays)
		throw new RangeError_(`baseline_days must be between 7 and ${LIMITS.baselineDays}`);
	const baseStart = addDays(start, -opts.baselineDays);
	const all = await dailySeries(api, baseStart, end);
	const period = all.rows.filter((r) => r.date >= start);
	const baseline = all.rows.filter((r) => r.date < start);
	const workouts = all.workoutRecords
		.filter((w) => {
			const d = localDate(w.start, w.timezone_offset);
			return d >= start && d <= end;
		})
		.map(normalizeWorkout)
		.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
	return {
		start,
		end,
		baseline: { start: baseStart, end: addDays(start, -1) },
		truncated: all.truncated,
		...summarize(period, baseline, workouts, { sleepTargetH: opts.sleepTargetH }),
	};
}
