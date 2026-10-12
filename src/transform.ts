// Pure conversions from WHOOP v2 records to compact, human-unit rows.
// No I/O here so it is fully unit-testable.

import type { Cycle, Recovery, ScoreState, Sleep, Workout } from "./whoop-types";

const MS_PER_HOUR = 3_600_000;
const MI_PER_M = 0.000621371;
const FT_PER_M = 3.28084;
const KJ_PER_KCAL = 4.184;

export const round = (n: number | undefined | null, dp = 1): number | null =>
	n === undefined || n === null || Number.isNaN(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp;

const hours = (ms: number | undefined) => (ms === undefined ? null : round(ms / MS_PER_HOUR, 2));
const minutes = (ms: number | undefined) => (ms === undefined ? null : round(ms / 60_000, 0));

/** "-05:00" | "+0530" | "Z" -> minutes east of UTC. Unknown formats fall back to 0. */
export function offsetMinutes(offset: string | undefined): number {
	if (!offset || offset === "Z") return 0;
	const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim());
	if (!m) return 0;
	const sign = m[1] === "-" ? -1 : 1;
	return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Wall-clock Date (as a UTC Date carrying local fields) for an instant + offset. */
function local(iso: string, offset: string): Date {
	return new Date(new Date(iso).getTime() + offsetMinutes(offset) * 60_000);
}

export const localDate = (iso: string, offset: string) => local(iso, offset).toISOString().slice(0, 10);
export const localTime = (iso: string, offset: string) => local(iso, offset).toISOString().slice(11, 16);

/** YYYY-MM-DD +/- n days. */
export function addDays(date: string, n: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(start: string, end: string): number {
	return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function eachDate(start: string, end: string): string[] {
	const out: string[] = [];
	for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
	return out;
}

// ---------- per-record normalizers ----------

export function asleepMs(s: Sleep): number | undefined {
	const st = s.score?.stage_summary;
	if (!st) return undefined;
	return st.total_light_sleep_time_milli + st.total_slow_wave_sleep_time_milli + st.total_rem_sleep_time_milli;
}

export function normalizeSleep(s: Sleep) {
	const st = s.score?.stage_summary;
	const need = s.score?.sleep_needed;
	return {
		date: localDate(s.end, s.timezone_offset), // the morning you woke up
		bedtime: localTime(s.start, s.timezone_offset),
		wake: localTime(s.end, s.timezone_offset),
		nap: s.nap,
		state: s.score_state,
		asleepH: hours(asleepMs(s)),
		inBedH: hours(st?.total_in_bed_time_milli),
		awakeH: hours(st?.total_awake_time_milli),
		lightH: hours(st?.total_light_sleep_time_milli),
		deepH: hours(st?.total_slow_wave_sleep_time_milli),
		remH: hours(st?.total_rem_sleep_time_milli),
		disturbances: st?.disturbance_count ?? null,
		sleepCycles: st?.sleep_cycle_count ?? null,
		neededH: need
			? hours(
					need.baseline_milli +
						need.need_from_sleep_debt_milli +
						need.need_from_recent_strain_milli +
						need.need_from_recent_nap_milli,
				)
			: null,
		performancePct: round(s.score?.sleep_performance_percentage, 0),
		efficiencyPct: round(s.score?.sleep_efficiency_percentage, 0),
		consistencyPct: round(s.score?.sleep_consistency_percentage, 0),
		respiratoryRate: round(s.score?.respiratory_rate, 1),
	};
}

export type WorkoutCategory = "run" | "bike" | "swim" | "strength" | "walk_hike" | "mobility" | "other";

export function categorize(sport: string): WorkoutCategory {
	const s = sport.toLowerCase();
	if (/run|jog|track/.test(s)) return "run";
	if (/cycl|spin|bike|peloton|biking/.test(s)) return "bike";
	if (/swim/.test(s)) return "swim";
	if (/weight|strength|functional|powerlift|crossfit|lift/.test(s)) return "strength";
	if (/walk|hik|ruck|stair|climb/.test(s)) return "walk_hike";
	if (/yoga|stretch|pilates|mobility/.test(s)) return "mobility";
	return "other";
}

export function normalizeWorkout(w: Workout) {
	const sc = w.score;
	const z = sc?.zone_durations;
	const durationMs = Date.parse(w.end) - Date.parse(w.start);
	return {
		date: localDate(w.start, w.timezone_offset),
		start: localTime(w.start, w.timezone_offset),
		sport: w.sport_name,
		category: categorize(w.sport_name),
		state: w.score_state,
		durationMin: minutes(durationMs),
		strain: round(sc?.strain, 1),
		avgHr: sc?.average_heart_rate ?? null,
		maxHr: sc?.max_heart_rate ?? null,
		kcal: sc ? round(sc.kilojoule / KJ_PER_KCAL, 0) : null,
		distanceMi: sc?.distance_meter !== undefined ? round(sc.distance_meter * MI_PER_M, 2) : null,
		elevationGainFt: sc?.altitude_gain_meter !== undefined ? round(sc.altitude_gain_meter * FT_PER_M, 0) : null,
		hrRecordedPct: round(sc?.percent_recorded, 0),
		zoneMin: z
			? {
					z0: minutes(z.zone_zero_milli),
					z1: minutes(z.zone_one_milli),
					z2: minutes(z.zone_two_milli),
					z3: minutes(z.zone_three_milli),
					z4: minutes(z.zone_four_milli),
					z5: minutes(z.zone_five_milli),
				}
			: null,
	};
}

// ---------- daily series (one row per local calendar day) ----------

export interface DailyRow {
	date: string;
	recoveryPct: number | null;
	recoveryState: ScoreState | null;
	calibrating: boolean | null;
	hrvMs: number | null;
	restingHr: number | null;
	spo2Pct: number | null;
	skinTempC: number | null;
	sleepH: number | null;
	inBedH: number | null;
	sleepPerformancePct: number | null;
	sleepEfficiencyPct: number | null;
	napH: number | null;
	dayStrain: number | null;
	kcal: number | null;
	avgHr: number | null;
	steps: number | null;
	workouts: number;
}

/**
 * A WHOOP cycle runs from one sleep onset to the next, so it starts the evening
 * before the calendar day it belongs to. Label each cycle by the morning its main
 * sleep ended; with no sleep, shift the start forward 6 h so a 23:00 start lands
 * on the next day and a 07:00 start stays on the same day.
 */
export function cycleDate(c: Cycle, mainSleep?: Sleep): string {
	if (mainSleep) return localDate(mainSleep.end, mainSleep.timezone_offset);
	const shifted = new Date(Date.parse(c.start) + 6 * MS_PER_HOUR).toISOString();
	return localDate(shifted, c.timezone_offset);
}

export function buildDailySeries(
	start: string,
	end: string,
	data: { cycles: Cycle[]; recoveries: Recovery[]; sleeps: Sleep[]; workouts: Workout[] },
): DailyRow[] {
	const rows = new Map<string, DailyRow>(
		eachDate(start, end).map((date) => [
			date,
			{
				date,
				recoveryPct: null,
				recoveryState: null,
				calibrating: null,
				hrvMs: null,
				restingHr: null,
				spo2Pct: null,
				skinTempC: null,
				sleepH: null,
				inBedH: null,
				sleepPerformancePct: null,
				sleepEfficiencyPct: null,
				napH: null,
				dayStrain: null,
				kcal: null,
				avgHr: null,
				steps: null,
				workouts: 0,
			},
		]),
	);

	const sleepById = new Map(data.sleeps.map((s) => [s.id, s]));
	const recoveryByCycle = new Map(data.recoveries.map((r) => [r.cycle_id, r]));
	const mainSleepByCycle = new Map<number, Sleep>();
	for (const s of data.sleeps) {
		if (s.nap) continue;
		const cur = mainSleepByCycle.get(s.cycle_id);
		if (!cur || (asleepMs(s) ?? 0) > (asleepMs(cur) ?? 0)) mainSleepByCycle.set(s.cycle_id, s);
	}

	const usedSleepIds = new Set<string>();
	for (const c of data.cycles) {
		const rec = recoveryByCycle.get(c.id);
		const main = (rec && sleepById.get(rec.sleep_id)) || mainSleepByCycle.get(c.id);
		const row = rows.get(cycleDate(c, main));
		if (!row) continue;
		if (c.score) {
			row.dayStrain = round(c.score.strain, 1);
			row.kcal = round(c.score.kilojoule / KJ_PER_KCAL, 0);
			row.avgHr = c.score.average_heart_rate;
		}
		row.steps = c.step_count ?? null;
		if (rec) {
			row.recoveryState = rec.score_state;
			if (rec.score) {
				row.recoveryPct = round(rec.score.recovery_score, 0);
				row.calibrating = rec.score.user_calibrating;
				row.hrvMs = round(rec.score.hrv_rmssd_milli, 1);
				row.restingHr = round(rec.score.resting_heart_rate, 0);
				row.spo2Pct = round(rec.score.spo2_percentage, 1);
				row.skinTempC = round(rec.score.skin_temp_celsius, 2);
			}
		}
		if (main) {
			usedSleepIds.add(main.id);
			const n = normalizeSleep(main);
			row.sleepH = n.asleepH;
			row.inBedH = n.inBedH;
			row.sleepPerformancePct = n.performancePct;
			row.sleepEfficiencyPct = n.efficiencyPct;
		}
	}

	for (const s of data.sleeps) {
		if (usedSleepIds.has(s.id)) continue;
		const row = rows.get(localDate(s.end, s.timezone_offset));
		if (!row) continue;
		const h = hours(asleepMs(s));
		if (h === null) continue;
		if (s.nap) row.napH = round((row.napH ?? 0) + h, 2);
		else if (row.sleepH === null) row.sleepH = h; // main sleep not tied to a fetched cycle
	}

	for (const w of data.workouts) {
		const row = rows.get(localDate(w.start, w.timezone_offset));
		if (row) row.workouts += 1;
	}

	return [...rows.values()];
}

// ---------- weekly summary ----------

const avg = (xs: (number | null)[]) => {
	const v = xs.filter((x): x is number => x !== null);
	return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function summarize(
	period: DailyRow[],
	baseline: DailyRow[],
	workouts: ReturnType<typeof normalizeWorkout>[],
	opts: { sleepTargetH: number },
) {
	const rec = period.map((r) => r.recoveryPct);
	const scored = rec.filter((x): x is number => x !== null);
	const baseRhr = avg(baseline.map((r) => r.restingHr));
	const baseHrv = avg(baseline.map((r) => r.hrvMs));
	const periodRhr = avg(period.map((r) => r.restingHr));
	const periodHrv = avg(period.map((r) => r.hrvMs));
	const elevatedRhrDays =
		baseRhr === null
			? []
			: period.filter((r) => r.restingHr !== null && r.restingHr >= baseRhr + 5).map((r) => r.date);
	const sleepNights = period.filter((r) => r.sleepH !== null);
	const red = scored.filter((x) => x < 34).length;

	const byCategory: Record<string, { count: number; minutes: number; miles: number; strain: number }> = {};
	for (const w of workouts) {
		const b = (byCategory[w.category] ??= { count: 0, minutes: 0, miles: 0, strain: 0 });
		b.count += 1;
		b.minutes += w.durationMin ?? 0;
		b.miles = round(b.miles + (w.distanceMi ?? 0), 2) ?? 0;
		b.strain = round(b.strain + (w.strain ?? 0), 1) ?? 0;
	}

	const flags: string[] = [];
	if (red >= 2) flags.push(`${red} red recovery days (<34%)`);
	if (elevatedRhrDays.length >= 3)
		flags.push(`resting HR >=5 bpm above baseline on ${elevatedRhrDays.length} days: ${elevatedRhrDays.join(", ")}`);
	const sleepAvg = avg(sleepNights.map((r) => r.sleepH));
	if (sleepAvg !== null && sleepAvg < opts.sleepTargetH)
		flags.push(`average sleep ${round(sleepAvg, 2)} h is below the ${opts.sleepTargetH} h target`);
	if (baseHrv !== null && periodHrv !== null && periodHrv < baseHrv * 0.9)
		flags.push(`HRV ${round(((periodHrv - baseHrv) / baseHrv) * 100, 0)}% vs baseline`);

	return {
		days: period.length,
		daysWithRecovery: scored.length,
		pendingOrUnscorable: period.filter((r) => r.recoveryState && r.recoveryState !== "SCORED").map((r) => r.date),
		recovery: {
			avgPct: round(avg(rec), 0),
			minPct: scored.length ? Math.min(...scored) : null,
			maxPct: scored.length ? Math.max(...scored) : null,
			green: scored.filter((x) => x >= 67).length,
			yellow: scored.filter((x) => x >= 34 && x < 67).length,
			red,
			byDay: period.map((r) => ({ date: r.date, pct: r.recoveryPct })),
		},
		hrv: {
			avgMs: round(periodHrv, 1),
			baselineAvgMs: round(baseHrv, 1),
			deltaPct: baseHrv && periodHrv !== null ? round(((periodHrv - baseHrv) / baseHrv) * 100, 0) : null,
		},
		restingHr: {
			avg: round(periodRhr, 1),
			baselineAvg: round(baseRhr, 1),
			delta: baseRhr !== null && periodRhr !== null ? round(periodRhr - baseRhr, 1) : null,
			elevatedDays: elevatedRhrDays,
		},
		sleep: {
			avgH: round(sleepAvg, 2),
			targetH: opts.sleepTargetH,
			nightsTracked: sleepNights.length,
			nightsBelowTarget: sleepNights.filter((r) => (r.sleepH ?? 0) < opts.sleepTargetH).length,
			avgPerformancePct: round(avg(period.map((r) => r.sleepPerformancePct)), 0),
			avgEfficiencyPct: round(avg(period.map((r) => r.sleepEfficiencyPct)), 0),
			napDays: period.filter((r) => r.napH !== null).length,
		},
		strain: {
			avgDaily: round(avg(period.map((r) => r.dayStrain)), 1),
			maxDaily: (() => {
				const s = period.map((r) => r.dayStrain).filter((x): x is number => x !== null);
				return s.length ? Math.max(...s) : null;
			})(),
		},
		workouts: { count: workouts.length, byCategory, list: workouts },
		flags,
	};
}
