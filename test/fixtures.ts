import type { Cycle, Recovery, Sleep, Workout } from "../src/whoop-types";

const H = 3_600_000;

/** A night of sleep ending on `date` at 06:30 local, in a -07:00 zone, with `asleepH` hours asleep. */
export function sleep(id: string, cycleId: number, date: string, asleepH: number, nap = false, offset = "-07:00"): Sleep {
	const end = new Date(`${date}T13:30:00.000Z`); // 06:30 at -07:00
	const inBed = asleepH + 0.5;
	const start = new Date(end.getTime() - inBed * H);
	const third = Math.round((asleepH * H) / 3);
	return {
		id,
		cycle_id: cycleId,
		user_id: 1,
		start: start.toISOString(),
		end: end.toISOString(),
		timezone_offset: offset,
		nap,
		score_state: "SCORED",
		score: {
			stage_summary: {
				total_in_bed_time_milli: inBed * H,
				total_awake_time_milli: 0.5 * H,
				total_no_data_time_milli: 0,
				total_light_sleep_time_milli: asleepH * H - 2 * third,
				total_slow_wave_sleep_time_milli: third,
				total_rem_sleep_time_milli: third,
				sleep_cycle_count: 4,
				disturbance_count: 3,
			},
			sleep_needed: {
				baseline_milli: 8 * H,
				need_from_sleep_debt_milli: 0,
				need_from_recent_strain_milli: 0,
				need_from_recent_nap_milli: 0,
			},
			sleep_performance_percentage: 90,
			sleep_efficiency_percentage: 93,
			sleep_consistency_percentage: 80,
			respiratory_rate: 15.2,
		},
	};
}

/** A cycle that started at sleep onset the evening before `date` (23:00 local, -07:00). */
export function cycle(id: number, date: string, strain = 10): Cycle {
	const d = new Date(`${date}T06:00:00.000Z`); // 23:00 previous day at -07:00
	return {
		id,
		user_id: 1,
		start: d.toISOString(),
		end: new Date(d.getTime() + 24 * H).toISOString(),
		timezone_offset: "-07:00",
		score_state: "SCORED",
		score: { strain, kilojoule: 8368, average_heart_rate: 70, max_heart_rate: 160 },
		step_count: 9000,
	};
}

export function recovery(cycleId: number, sleepId: string, pct: number, rhr = 55, hrv = 60): Recovery {
	return {
		cycle_id: cycleId,
		sleep_id: sleepId,
		user_id: 1,
		created_at: "2026-10-01T14:00:00.000Z",
		score_state: "SCORED",
		score: {
			user_calibrating: false,
			recovery_score: pct,
			resting_heart_rate: rhr,
			hrv_rmssd_milli: hrv,
			spo2_percentage: 96.5,
			skin_temp_celsius: 33.4,
		},
	};
}

export function workout(id: string, startIso: string, sport: string, minutes: number, distanceM?: number): Workout {
	return {
		id,
		user_id: 1,
		start: startIso,
		end: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(),
		timezone_offset: "-07:00",
		sport_name: sport,
		score_state: "SCORED",
		score: {
			strain: 12.34,
			average_heart_rate: 145,
			max_heart_rate: 172,
			kilojoule: 2092,
			percent_recorded: 100,
			distance_meter: distanceM,
			altitude_gain_meter: 100,
			zone_durations: {
				zone_zero_milli: 0,
				zone_one_milli: 5 * 60_000,
				zone_two_milli: 30 * 60_000,
				zone_three_milli: 20 * 60_000,
				zone_four_milli: 5 * 60_000,
				zone_five_milli: 0,
			},
		},
	};
}

/** Day-by-day dataset: one cycle + sleep + recovery per date. */
export function days(dates: string[], f: (date: string, i: number) => { pct: number; rhr?: number; hrv?: number; sleepH?: number }) {
	const cycles: Cycle[] = [];
	const sleeps: Sleep[] = [];
	const recoveries: Recovery[] = [];
	dates.forEach((date, i) => {
		const v = f(date, i);
		const id = 1000 + i;
		cycles.push(cycle(id, date));
		sleeps.push(sleep(`s-${date}`, id, date, v.sleepH ?? 7.5));
		recoveries.push(recovery(id, `s-${date}`, v.pct, v.rhr, v.hrv));
	});
	return { cycles, sleeps, recoveries };
}
