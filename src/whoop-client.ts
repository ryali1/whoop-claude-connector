// Minimal client for the official WHOOP Developer API v2 (read-only).
// Never logs response bodies or tokens: WHOOP data is personal health data.

import type { BasicProfile, BodyMeasurement, Cycle, Page, Recovery, Sleep, Workout } from "./whoop-types";

export const WHOOP_API = "https://api.prod.whoop.com/developer";
const PAGE_LIMIT = 25; // API maximum

export class WhoopError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly reauth = false,
	) {
		super(message);
	}
}

export class BudgetExceeded extends Error {}

export interface TokenSource {
	/** Current access token. Passing the token that just got a 401 forces a refresh unless it already rotated. */
	getAccessToken(stale?: string): Promise<string>;
}

export interface ClientOptions {
	fetchImpl?: typeof fetch;
	/**
	 * Max upstream requests per tool call. Cloudflare's free plan allows 50 subrequests
	 * per invocation; keep headroom for the token refresh.
	 */
	requestBudget?: number;
	sleepImpl?: (ms: number) => Promise<void>;
}

export interface Collected<T> {
	records: T[];
	truncated: boolean;
}

export class WhoopClient {
	private used = 0;
	/** One token lookup per tool call (each lookup is a Durable Object subrequest), shared by parallel pages. */
	private token: Promise<string> | null = null;
	private readonly fetchImpl: typeof fetch;
	private readonly budget: number;
	private readonly sleep: (ms: number) => Promise<void>;

	constructor(
		private readonly tokens: TokenSource,
		opts: ClientOptions = {},
	) {
		this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
		this.budget = opts.requestBudget ?? 44;
		this.sleep = opts.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	}

	get requestsUsed() {
		return this.used;
	}

	async get<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
		const url = new URL(WHOOP_API + path);
		for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);

		let token = await (this.token ??= this.tokens.getAccessToken());
		for (let attempt = 0; attempt < 3; attempt++) {
			if (this.used >= this.budget) throw new BudgetExceeded("request budget exhausted");
			this.used++;
			const res = await this.fetchImpl(url.toString(), {
				headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
			});
			if (res.ok) return (await res.json()) as T;
			if (res.status === 401 && attempt === 0) {
				const stale = token;
				// Parallel pages that hit the same 401 share one refresh.
				const cur = this.token;
				if (!cur || (await cur) === stale) this.token = this.tokens.getAccessToken(stale);
				token = await this.token!;
				continue;
			}
			if (res.status === 429 && attempt < 2) {
				const retryAfter = Number(res.headers.get("Retry-After"));
				await this.sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000, 5000));
				continue;
			}
			console.log(JSON.stringify({ evt: "whoop_api_error", path, status: res.status }));
			if (res.status === 401)
				throw new WhoopError("WHOOP rejected the access token", 401, true);
			if (res.status === 429) throw new WhoopError("WHOOP rate limit hit; try again in a minute", 429);
			throw new WhoopError(`WHOOP API returned ${res.status}`, res.status);
		}
		throw new WhoopError("WHOOP request failed after retries", 0);
	}

	/** Pages through a v2 collection within [startIso, endIso), stopping at maxPages or the request budget. */
	async collect<T>(path: string, startIso: string, endIso: string, maxPages: number): Promise<Collected<T>> {
		const records: T[] = [];
		let nextToken: string | undefined;
		for (let page = 0; page < maxPages; page++) {
			let res: Page<T>;
			try {
				res = await this.get<Page<T>>(path, {
					limit: String(PAGE_LIMIT),
					start: startIso,
					end: endIso,
					nextToken,
				});
			} catch (e) {
				if (e instanceof BudgetExceeded) return { records, truncated: true };
				throw e;
			}
			records.push(...res.records);
			if (!res.next_token) return { records, truncated: false };
			nextToken = res.next_token;
		}
		return { records, truncated: true };
	}

	profile = () => this.get<BasicProfile>("/v2/user/profile/basic");
	body = () => this.get<BodyMeasurement>("/v2/user/measurement/body");
	cycles = (s: string, e: string, p: number) => this.collect<Cycle>("/v2/cycle", s, e, p);
	recoveries = (s: string, e: string, p: number) => this.collect<Recovery>("/v2/recovery", s, e, p);
	sleeps = (s: string, e: string, p: number) => this.collect<Sleep>("/v2/activity/sleep", s, e, p);
	workouts = (s: string, e: string, p: number) => this.collect<Workout>("/v2/activity/workout", s, e, p);
}
