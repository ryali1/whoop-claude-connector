// Durable Object that owns the single WHOOP token pair. One instance ("owner")
// serializes refreshes; a daily alarm keeps the refresh token exercised.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { TokenManager, type TokenResponse } from "./tokens";

const DAY_MS = 86_400_000;

export class WhoopTokenStore extends DurableObject<Env> {
	private readonly mgr: TokenManager;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.mgr = new TokenManager(ctx.storage, {
			clientId: env.WHOOP_CLIENT_ID,
			clientSecret: env.WHOOP_CLIENT_SECRET,
		});
	}

	async saveTokens(whoopUserId: string, tokens: TokenResponse): Promise<void> {
		await this.mgr.save(whoopUserId, tokens);
		await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
	}

	getAccessToken(stale?: string): Promise<string> {
		return this.mgr.getAccessToken(stale);
	}

	status() {
		return this.mgr.status();
	}

	async alarm() {
		try {
			await this.mgr.refresh();
		} catch (e) {
			console.log(JSON.stringify({ evt: "scheduled_refresh_failed", name: (e as Error)?.name }));
		}
		if ((await this.mgr.status()).connected) await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
	}
}

export function tokenStore(env: Env) {
	return env.WHOOP_TOKENS.get(env.WHOOP_TOKENS.idFromName("owner"));
}
