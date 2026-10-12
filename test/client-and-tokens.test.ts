import { describe, expect, it, vi } from "vitest";
import { dailySeries, RangeError_, weeklySummary } from "../src/queries";
import { type KeyValueStorage, ReauthRequired, TokenManager, WHOOP_TOKEN_URL } from "../src/tokens";
import { BudgetExceeded, WhoopClient, WhoopError } from "../src/whoop-client";
import { authorizeUrl, eightCharState, ownerCheck } from "../src/whoop-oauth";
import { days } from "./fixtures";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const staticTokens = { getAccessToken: async () => "tok" };

function memStorage(): KeyValueStorage & { data: Map<string, unknown> } {
	const data = new Map<string, unknown>();
	return {
		data,
		get: async <T>(k: string) => data.get(k) as T | undefined,
		put: async <T>(k: string, v: T) => void data.set(k, structuredClone(v)),
		delete: async (k: string) => data.delete(k),
	};
}

describe("WhoopClient", () => {
	it("follows next_token until exhausted", async () => {
		const fetchImpl = vi.fn(async (url: string) => {
			const tok = new URL(url).searchParams.get("nextToken");
			return json(tok ? { records: [3], next_token: null } : { records: [1, 2], next_token: "p2" });
		});
		const c = new WhoopClient(staticTokens, { fetchImpl: fetchImpl as any });
		const res = await c.collect<number>("/v2/cycle", "a", "b", 10);
		expect(res).toEqual({ records: [1, 2, 3], truncated: false });
		expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("limit")).toBe("25");
	});

	it("stops at maxPages and marks the result truncated", async () => {
		const c = new WhoopClient(staticTokens, { fetchImpl: (async () => json({ records: [1], next_token: "more" })) as any });
		expect(await c.collect("/v2/cycle", "a", "b", 3)).toEqual({ records: [1, 1, 1], truncated: true });
	});

	it("enforces the per-call request budget", async () => {
		const fetchImpl = vi.fn(async () => json({ records: [1], next_token: "more" }));
		const c = new WhoopClient(staticTokens, { fetchImpl: fetchImpl as any, requestBudget: 4 });
		const res = await c.collect("/v2/cycle", "a", "b", 100);
		expect(res.truncated).toBe(true);
		expect(fetchImpl).toHaveBeenCalledTimes(4);
		await expect(c.get("/v2/user/profile/basic")).rejects.toBeInstanceOf(BudgetExceeded);
	});

	it("retries once with a refreshed token on 401", async () => {
		const tokens = { getAccessToken: vi.fn(async (stale?: string) => (stale ? "new" : "old")) };
		const fetchImpl = vi.fn(async (_u: string, init: RequestInit) =>
			(init.headers as Record<string, string>).Authorization === "Bearer new" ? json({ ok: 1 }) : json({}, 401),
		);
		const c = new WhoopClient(tokens, { fetchImpl: fetchImpl as any });
		expect(await c.get("/x")).toEqual({ ok: 1 });
		expect(tokens.getAccessToken).toHaveBeenLastCalledWith("old");
	});

	it("looks the token up once per client and shares it across pages", async () => {
		const tokens = { getAccessToken: vi.fn(async () => "tok") };
		const fetchImpl = vi.fn(async (url: string) =>
			json(new URL(url).searchParams.get("nextToken") ? { records: [2] } : { records: [1], next_token: "p2" }),
		);
		const c = new WhoopClient(tokens, { fetchImpl: fetchImpl as any });
		await Promise.all([c.collect("/v2/cycle", "a", "b", 5), c.collect("/v2/recovery", "a", "b", 5), c.get("/x")]);
		expect(fetchImpl).toHaveBeenCalledTimes(5);
		expect(tokens.getAccessToken).toHaveBeenCalledTimes(1);
	});

	it("surfaces a persistent 401 as reauth", async () => {
		const c = new WhoopClient(staticTokens, { fetchImpl: (async () => json({}, 401)) as any });
		await expect(c.get("/x")).rejects.toMatchObject({ reauth: true });
	});

	it("backs off on 429 using Retry-After, capped", async () => {
		const sleeps: number[] = [];
		let n = 0;
		const c = new WhoopClient(staticTokens, {
			fetchImpl: (async () => (n++ === 0 ? json({}, 429, { "Retry-After": "30" }) : json({ ok: 1 }))) as any,
			sleepImpl: async (ms) => void sleeps.push(ms),
		});
		expect(await c.get("/x")).toEqual({ ok: 1 });
		expect(sleeps).toEqual([5000]);
	});

	it("does not leak response bodies into errors", async () => {
		const c = new WhoopClient(staticTokens, { fetchImpl: (async () => json({ secret: "phi" }, 500)) as any });
		const err = (await c.get("/x").catch((e) => e)) as WhoopError;
		expect(err).toBeInstanceOf(WhoopError);
		expect(String(err.message)).not.toContain("phi");
	});
});

describe("TokenManager", () => {
	const cfg = { clientId: "id", clientSecret: "secret" };
	const seed = async (s: KeyValueStorage, now: number, expiresInS: number) =>
		new TokenManager(s, cfg, undefined, () => now).save("42", {
			access_token: "a1",
			refresh_token: "r1",
			expires_in: expiresInS,
		});

	it("returns the cached token while fresh", async () => {
		const s = memStorage();
		await seed(s, 0, 3600);
		const fetchImpl = vi.fn();
		const m = new TokenManager(s, cfg, fetchImpl as any, () => 1000);
		expect(await m.getAccessToken()).toBe("a1");
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("refreshes once for many concurrent callers and stores the rotated pair", async () => {
		const s = memStorage();
		await seed(s, 0, 3600);
		let resolve!: (r: Response) => void;
		const fetchImpl = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
		const m = new TokenManager(s, cfg, fetchImpl as any, () => 3600_000); // expired
		const all = Promise.all([m.getAccessToken(), m.getAccessToken(), m.getAccessToken()]);
		await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
		resolve(json({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }));
		expect(await all).toEqual(["a2", "a2", "a2"]);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(WHOOP_TOKEN_URL);
		const body = new URLSearchParams(String(init.body));
		expect(Object.fromEntries(body)).toMatchObject({ grant_type: "refresh_token", refresh_token: "r1", scope: "offline" });
		expect(s.data.get("whoop_tokens")).toMatchObject({ accessToken: "a2", refreshToken: "r2", whoopUserId: "42" });
	});

	it("refreshes early inside the skew window", async () => {
		const s = memStorage();
		await seed(s, 0, 3600);
		const fetchImpl = vi.fn(async () => json({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }));
		const m = new TokenManager(s, cfg, fetchImpl as any, () => 3600_000 - 60_000);
		expect(await m.getAccessToken()).toBe("a2");
	});

	it("a stale-token report only refreshes if that token is still current", async () => {
		const s = memStorage();
		await seed(s, 0, 3600);
		const fetchImpl = vi.fn(async () => json({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }));
		const m = new TokenManager(s, cfg, fetchImpl as any, () => 1000);
		expect(await m.getAccessToken("already-rotated")).toBe("a1");
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(await m.getAccessToken("a1")).toBe("a2");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("asks for reauth when WHOOP rejects the refresh token or nothing is stored", async () => {
		const s = memStorage();
		await expect(new TokenManager(s, cfg).getAccessToken()).rejects.toBeInstanceOf(ReauthRequired);
		await seed(s, 0, 1);
		const m = new TokenManager(s, cfg, (async () => json({ error: "invalid_grant" }, 400)) as any, () => 10_000_000);
		await expect(m.getAccessToken()).rejects.toBeInstanceOf(ReauthRequired);
	});

	it("refuses to save a grant without a refresh token", async () => {
		await expect(new TokenManager(memStorage(), cfg).save("1", { access_token: "a", expires_in: 1 })).rejects.toThrow(/offline/);
	});
});

describe("upstream OAuth helpers", () => {
	it("makes 8-char alphanumeric states", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) {
			const s = eightCharState();
			expect(s).toMatch(/^[A-Za-z0-9]{8}$/);
			seen.add(s);
		}
		expect(seen.size).toBe(200);
	});

	it("requests every read scope plus offline", () => {
		const u = new URL(authorizeUrl("cid", "https://x.workers.dev/callback", "abcdefgh"));
		expect(u.origin + u.pathname).toBe("https://api.prod.whoop.com/oauth/oauth2/auth");
		expect(u.searchParams.get("scope")!.split(" ").sort()).toEqual(
			["offline", "read:body_measurement", "read:cycles", "read:profile", "read:recovery", "read:sleep", "read:workout"].sort(),
		);
		expect(u.searchParams.get("state")).toBe("abcdefgh");
	});

	it("only lets the configured owner in and fails closed when unset", () => {
		expect(ownerCheck("42", "42")).toBe("owner");
		expect(ownerCheck("42", " 42 ")).toBe("owner");
		expect(ownerCheck("43", "42")).toBe("denied");
		expect(ownerCheck("42", undefined)).toBe("setup");
		expect(ownerCheck("42", "")).toBe("setup");
	});
});

describe("queries", () => {
	function fakeApi(data: ReturnType<typeof days>) {
		const page = (records: unknown[]) => async () => ({ records, truncated: false });
		return {
			cycles: page(data.cycles),
			recoveries: page(data.recoveries),
			sleeps: page(data.sleeps),
			workouts: page([]),
		} as unknown as WhoopClient;
	}

	it("rejects inverted and oversized ranges with a hint to split", async () => {
		const api = fakeApi(days([], () => ({ pct: 0 })));
		await expect(dailySeries(api, "2026-10-10", "2026-10-01")).rejects.toBeInstanceOf(RangeError_);
		await expect(dailySeries(api, "2025-01-01", "2026-01-01")).rejects.toThrow(/Split it/);
	});

	it("weekly summary separates the period from its baseline", async () => {
		const dates = ["2026-09-30", "2026-10-01", "2026-10-05", "2026-10-06"];
		const api = fakeApi(days(dates, (d) => ({ pct: d >= "2026-10-05" ? 30 : 80, rhr: 50 })));
		const s = await weeklySummary(api, "2026-10-05", "2026-10-11", { baselineDays: 28, sleepTargetH: 7.5 });
		expect(s.baseline).toEqual({ start: "2026-09-07", end: "2026-10-04" });
		expect(s.days).toBe(7);
		expect(s.daysWithRecovery).toBe(2);
		expect(s.recovery.red).toBe(2);
		expect(s.restingHr.baselineAvg).toBe(50);
	});
});
