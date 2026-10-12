// Upstream OAuth (this server as a client of WHOOP).

import type { TokenResponse } from "./tokens";
import { WHOOP_TOKEN_URL } from "./tokens";

export const WHOOP_AUTHORIZE_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const WHOOP_SCOPES = [
	"read:recovery",
	"read:cycles",
	"read:sleep",
	"read:workout",
	"read:profile",
	"read:body_measurement",
	"offline",
].join(" ");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** WHOOP requires a self-generated `state` to be exactly 8 characters. */
export function eightCharState(): string {
	// 248 = 62 * 4: rejection sampling keeps the distribution uniform.
	const out: string[] = [];
	while (out.length < 8) {
		for (const b of crypto.getRandomValues(new Uint8Array(16))) {
			if (b < 248 && out.length < 8) out.push(ALPHABET[b % 62]);
		}
	}
	return out.join("");
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
	const u = new URL(WHOOP_AUTHORIZE_URL);
	u.searchParams.set("client_id", clientId);
	u.searchParams.set("redirect_uri", redirectUri);
	u.searchParams.set("response_type", "code");
	u.searchParams.set("scope", WHOOP_SCOPES);
	u.searchParams.set("state", state);
	return u.href;
}

export async function exchangeCode(
	args: { code: string; clientId: string; clientSecret: string; redirectUri: string },
	fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<TokenResponse> {
	const res = await fetchImpl(WHOOP_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: args.code,
			client_id: args.clientId,
			client_secret: args.clientSecret,
			redirect_uri: args.redirectUri,
		}).toString(),
	});
	if (!res.ok) {
		console.log(JSON.stringify({ evt: "whoop_code_exchange_failed", status: res.status }));
		throw new Error(`WHOOP code exchange failed (${res.status})`);
	}
	const body = (await res.json()) as TokenResponse;
	if (!body.access_token) throw new Error("WHOOP code exchange returned no access token");
	return body;
}

/** Best-effort: drop a non-owner's grant so we hold nothing for them. */
export async function revokeAccess(accessToken: string, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
	try {
		await fetchImpl("https://api.prod.whoop.com/developer/v2/user/access", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${accessToken}` },
		});
	} catch {
		// ignore: the token is never stored either way
	}
}

/** Owner allowlist. Fails closed when unset. */
export function ownerCheck(whoopUserId: string, configured: string | undefined): "owner" | "setup" | "denied" {
	const want = configured?.trim();
	if (!want) return "setup";
	return want === whoopUserId ? "owner" : "denied";
}
