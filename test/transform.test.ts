import { describe, expect, it } from "vitest";
import {
	addDays,
	buildDailySeries,
	categorize,
	cycleDate,
	eachDate,
	localDate,
	normalizeSleep,
	normalizeWorkout,
	offsetMinutes,
	summarize,
} from "../src/transform";
import { cycle, days, recovery, sleep, workout } from "./fixtures";

describe("time helpers", () => {
	it("parses timezone offsets", () => {
		expect(offsetMinutes("-07:00")).toBe(-420);
		expect(offsetMinutes("+0530")).toBe(330);
		expect(offsetMinutes("Z")).toBe(0);
		expect(offsetMinutes("garbage")).toBe(0);
	});

	it("uses the record's own offset for the local date", () => {
		// 03:00Z on Oct 12 is 20:00 on Oct 11 in Pacific time
		expect(localDate("2026-10-12T03:00:00.000Z", "-07:00")).toBe("2026-10-11");
		expect(localDate("2026-10-12T03:00:00.000Z", "+05:30")).toBe("2026-10-12");
	});

	it("walks calendar days across month ends", () => {
		expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
		expect(eachDate("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
	});
});

describe("cycleDate", () => {
	it("labels a cycle by the morning its sleep ended", () => {
		const c = cycle(1, "2026-10-10");
		expect(localDate(c.start, c.timezone_offset)).toBe("2026-10-09"); // starts the evening before
		expect(cycleDate(c, sleep("s", 1, "2026-10-10", 7))).toBe("2026-10-10");
	});

	it("falls back to start + 6h when there is no sleep", () => {
		expect(cycleDate(cycle(1, "2026-10-10"))).toBe("2026-10-10");
	});
});

describe("normalizers", () => {
	it("converts sleep stages to hours and dates by wake-up", () => {
		const n = normalizeSleep(sleep("s", 1, "2026-10-10", 7.2));
		expect(n.date).toBe("2026-10-10");
		expect(n.wake).toBe("06:30");
		expect(n.asleepH).toBeCloseTo(7.2, 2);
		expect(n.inBedH).toBeCloseTo(7.7, 2);
		expect(n.neededH).toBe(8);
	});

	it("converts workouts to miles, feet, kcal and zone minutes", () => {
		const w = normalizeWorkout(workout("w", "2026-10-10T15:00:00.000Z", "Running", 120, 21097.5));
		expect(w).toMatchObject({
			date: "2026-10-10",
			start: "08:00",
			category: "run",
			durationMin: 120,
			distanceMi: 13.11,
			elevationGainFt: 328,
			kcal: 500,
			strain: 12.3,
			zoneMin: { z1: 5, z2: 30, z3: 20, z4: 5 },
		});
	});

	it("leaves distance null when WHOOP has none", () => {
		expect(normalizeWorkout(workout("w", "2026-10-10T15:00:00.000Z", "Swimming", 45)).distanceMi).toBeNull();
	});

	it("maps the plan's session types", () => {
		expect(categorize("Running")).toBe("run");
		expect(categorize("Spin")).toBe("bike");
		expect(categorize("Cycling")).toBe("bike");
		expect(categorize("Swimming")).toBe("swim");
		expect(categorize("Weightlifting")).toBe("strength");
		expect(categorize("Functional Fitness")).toBe("strength");
		expect(categorize("Hiking/Rucking")).toBe("walk_hike");
		expect(categorize("Walking")).toBe("walk_hike");
		expect(categorize("Yoga")).toBe("mobility");
		expect(categorize("Pickleball")).toBe("other");
	});
});

describe("buildDailySeries", () => {
	it("joins recovery, sleep, strain and workouts per local day and keeps empty days", () => {
		const d = days(["2026-10-09", "2026-10-10"], (_, i) => ({ pct: 50 + i * 20, sleepH: 6 + i }));
		const rows = buildDailySeries("2026-10-08", "2026-10-10", {
			...d,
			workouts: [workout("w", "2026-10-10T15:00:00.000Z", "Running", 60)],
		});
		expect(rows.map((r) => r.date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-10"]);
		expect(rows[0]).toMatchObject({ recoveryPct: null, sleepH: null, workouts: 0 });
		expect(rows[1]).toMatchObject({ recoveryPct: 50, sleepH: 6, dayStrain: 10, kcal: 2000, restingHr: 55, hrvMs: 60 });
		expect(rows[2]).toMatchObject({ recoveryPct: 70, sleepH: 7, workouts: 1, steps: 9000 });
	});

	it("adds naps separately and does not double count them as sleep", () => {
		const d = days(["2026-10-10"], () => ({ pct: 60, sleepH: 6.5 }));
		const nap = sleep("nap", 1000, "2026-10-10", 0.5, true);
		const rows = buildDailySeries("2026-10-10", "2026-10-10", { ...d, sleeps: [...d.sleeps, nap], workouts: [] });
		expect(rows[0].sleepH).toBe(6.5);
		expect(rows[0].napH).toBe(0.5);
	});

	it("reports pending scores as null with the state, never as numbers", () => {
		const d = days(["2026-10-10"], () => ({ pct: 60 }));
		d.recoveries[0] = { ...d.recoveries[0], score_state: "PENDING_SCORE", score: undefined };
		const rows = buildDailySeries("2026-10-10", "2026-10-10", { ...d, workouts: [] });
		expect(rows[0]).toMatchObject({ recoveryPct: null, recoveryState: "PENDING_SCORE", hrvMs: null });
	});

	it("drops records that fall outside the range", () => {
		const d = days(["2026-10-01", "2026-10-10"], () => ({ pct: 60 }));
		const rows = buildDailySeries("2026-10-10", "2026-10-10", { ...d, workouts: [] });
		expect(rows).toHaveLength(1);
		expect(rows[0].recoveryPct).toBe(60);
	});
});

describe("summarize", () => {
	const baselineDates = eachDate("2026-09-07", "2026-10-04");
	const periodDates = eachDate("2026-10-05", "2026-10-11");

	it("computes recovery bands, deltas and flags against the baseline", () => {
		const base = buildDailySeries(baselineDates[0], baselineDates.at(-1)!, {
			...days(baselineDates, () => ({ pct: 70, rhr: 52, hrv: 70, sleepH: 7.6 })),
			workouts: [],
		});
		const period = buildDailySeries(periodDates[0], periodDates.at(-1)!, {
			...days(periodDates, (_, i) => ({ pct: [20, 25, 50, 80, 60, 30, 70][i], rhr: i < 4 ? 58 : 53, hrv: 55, sleepH: 6.5 })),
			workouts: [],
		});
		const s = summarize(period, base, [], { sleepTargetH: 7.5 });
		expect(s.recovery).toMatchObject({ green: 2, yellow: 2, red: 3, minPct: 20, maxPct: 80 });
		expect(s.restingHr.baselineAvg).toBe(52);
		expect(s.restingHr.elevatedDays).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
		expect(s.hrv.deltaPct).toBe(-21);
		expect(s.sleep).toMatchObject({ avgH: 6.5, nightsBelowTarget: 7, nightsTracked: 7 });
		expect(s.flags.join(" | ")).toMatch(/3 red recovery days/);
		expect(s.flags.join(" | ")).toMatch(/resting HR >=5 bpm above baseline on 4 days/);
		expect(s.flags.join(" | ")).toMatch(/below the 7.5 h target/);
		expect(s.flags.join(" | ")).toMatch(/HRV -21% vs baseline/);
	});

	it("handles an empty week without inventing numbers", () => {
		const period = buildDailySeries(periodDates[0], periodDates.at(-1)!, { cycles: [], recoveries: [], sleeps: [], workouts: [] });
		const s = summarize(period, [], [], { sleepTargetH: 7.5 });
		expect(s.daysWithRecovery).toBe(0);
		expect(s.recovery.avgPct).toBeNull();
		expect(s.sleep.avgH).toBeNull();
		expect(s.strain.maxDaily).toBeNull();
		expect(s.flags).toEqual([]);
	});

	it("totals workouts by category", () => {
		const ws = [
			workout("a", "2026-10-06T15:00:00.000Z", "Running", 130, 21097.5),
			workout("b", "2026-10-08T15:00:00.000Z", "Running", 60, 8046.7),
			workout("c", "2026-10-07T15:00:00.000Z", "Swimming", 40),
		].map(normalizeWorkout);
		const s = summarize([], [], ws, { sleepTargetH: 7.5 });
		expect(s.workouts.count).toBe(3);
		expect(s.workouts.byCategory.run).toMatchObject({ count: 2, minutes: 190, miles: 18.11 });
		expect(s.workouts.byCategory.swim.count).toBe(1);
	});
});
