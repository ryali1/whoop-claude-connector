// WHOOP OAuth token lifecycle. WHOOP rotates refresh tokens and invalidates the
// old one on use, so concurrent refreshes race: the first wins and the rest fail.
// TokenManager is single-flight and lives inside one Durable Object, which makes it
// the only writer of the token pair.

export const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
export const REFRESH_SKEW_MS = 5 * 60_000;

export interface StoredTokens {
	accessToken: string;
	refreshToken: string;
	expiresAt: number; // epoch ms
	whoopUserId: string;
	scope?: string;
	updatedAt: number;
}

export interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	scope?: string;
	token_type?: string;
}

export interface KeyValueStorage {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<boolean>;
}

export class ReauthRequired extends Error {
	constructor() {
		super(
			"WHOOP is not connected or its authorization expired. Reconnect it: claude.ai -> Settings -> Connectors -> WHOOP -> Disconnect, then Connect.",
		);
	}
}

const KEY = "whoop_tokens";

export class TokenManager {
	private inflight: Promise<StoredTokens> | null = null;

	constructor(
		private readonly storage: KeyValueStorage,
		private readonly cfg: { clientId: string; clientSecret: string },
		private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
		private readonly now: () => number = Date.now,
	) {}

	async save(whoopUserId: string, t: TokenResponse): Promise<void> {
		if (!t.refresh_token) throw new Error("WHOOP did not return a refresh token (is the offline scope granted?)");
		await this.storage.put<StoredTokens>(KEY, this.toStored(whoopUserId, t, t.refresh_token));
	}

	async status() {
		const t = await this.storage.get<StoredTokens>(KEY);
		return t ? { connected: true, whoopUserId: t.whoopUserId, expiresAt: t.expiresAt, updatedAt: t.updatedAt } : { connected: false };
	}

	async clear() {
		await this.storage.delete(KEY);
	}

	async getAccessToken(stale?: string): Promise<string> {
		const t = await this.storage.get<StoredTokens>(KEY);
		if (!t) throw new ReauthRequired();
		const fresh = t.expiresAt - this.now() > REFRESH_SKEW_MS;
		// A caller reporting a 401 on a token that has since rotated just gets the new one.
		if (fresh && (stale === undefined || stale !== t.accessToken)) return t.accessToken;
		return (await this.refresh()).accessToken;
	}

	/** Single-flight refresh: every concurrent caller awaits the same upstream call. */
	refresh(): Promise<StoredTokens> {
		this.inflight ??= this.doRefresh().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	private async doRefresh(): Promise<StoredTokens> {
		const cur = await this.storage.get<StoredTokens>(KEY);
		if (!cur) throw new ReauthRequired();
		const res = await this.fetchImpl(WHOOP_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: cur.refreshToken,
				client_id: this.cfg.clientId,
				client_secret: this.cfg.clientSecret,
				scope: "offline",
			}).toString(),
		});
		if (res.status === 400 || res.status === 401) {
			console.log(JSON.stringify({ evt: "whoop_refresh_rejected", status: res.status }));
			throw new ReauthRequired();
		}
		if (!res.ok) {
			console.log(JSON.stringify({ evt: "whoop_refresh_error", status: res.status }));
			throw new Error(`WHOOP token refresh failed (${res.status}); try again shortly`);
		}
		const body = (await res.json()) as TokenResponse;
		const next = this.toStored(cur.whoopUserId, body, body.refresh_token ?? cur.refreshToken);
		await this.storage.put(KEY, next);
		return next;
	}

	private toStored(whoopUserId: string, t: TokenResponse, refreshToken: string): StoredTokens {
		const now = this.now();
		return {
			accessToken: t.access_token,
			refreshToken,
			expiresAt: now + t.expires_in * 1000,
			whoopUserId,
			scope: t.scope,
			updatedAt: now,
		};
	}
}
