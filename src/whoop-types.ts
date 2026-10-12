// Shapes of WHOOP Developer API v2 records (subset we use), per
// https://api.prod.whoop.com/developer/doc/openapi.json

export type ScoreState = "SCORED" | "PENDING_SCORE" | "UNSCORABLE";

export interface Cycle {
	id: number;
	user_id: number;
	start: string;
	end?: string;
	timezone_offset: string;
	score_state: ScoreState;
	score?: {
		strain: number;
		kilojoule: number;
		average_heart_rate: number;
		max_heart_rate: number;
	};
	step_count?: number | null;
}

export interface Recovery {
	cycle_id: number;
	sleep_id: string;
	user_id: number;
	created_at: string;
	score_state: ScoreState;
	score?: {
		user_calibrating: boolean;
		recovery_score: number;
		resting_heart_rate: number;
		hrv_rmssd_milli: number;
		spo2_percentage?: number;
		skin_temp_celsius?: number;
	};
}

export interface Sleep {
	id: string;
	cycle_id: number;
	user_id: number;
	start: string;
	end: string;
	timezone_offset: string;
	nap: boolean;
	score_state: ScoreState;
	score?: {
		stage_summary: {
			total_in_bed_time_milli: number;
			total_awake_time_milli: number;
			total_no_data_time_milli: number;
			total_light_sleep_time_milli: number;
			total_slow_wave_sleep_time_milli: number;
			total_rem_sleep_time_milli: number;
			sleep_cycle_count: number;
			disturbance_count: number;
		};
		sleep_needed: {
			baseline_milli: number;
			need_from_sleep_debt_milli: number;
			need_from_recent_strain_milli: number;
			need_from_recent_nap_milli: number;
		};
		respiratory_rate?: number;
		sleep_performance_percentage?: number;
		sleep_consistency_percentage?: number;
		sleep_efficiency_percentage?: number;
	};
}

export interface Workout {
	id: string;
	user_id: number;
	start: string;
	end: string;
	timezone_offset: string;
	sport_name: string;
	score_state: ScoreState;
	score?: {
		strain: number;
		average_heart_rate: number;
		max_heart_rate: number;
		kilojoule: number;
		percent_recorded: number;
		distance_meter?: number;
		altitude_gain_meter?: number;
		altitude_change_meter?: number;
		zone_durations: {
			zone_zero_milli: number;
			zone_one_milli: number;
			zone_two_milli: number;
			zone_three_milli: number;
			zone_four_milli: number;
			zone_five_milli: number;
		};
	};
}

export interface BasicProfile {
	user_id: number;
	email: string;
	first_name: string;
	last_name: string;
}

export interface BodyMeasurement {
	height_meter: number;
	weight_kilogram: number;
	max_heart_rate: number;
}

export interface Page<T> {
	records: T[];
	next_token?: string | null;
}
