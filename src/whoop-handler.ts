// Browser-facing routes: consent, WHOOP OAuth hand-off, callback, and the
// public pages WHOOP's developer dashboard requires (privacy policy).

import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Env, Props } from "./env";
import { cookieKey, page, setupPage, setupState } from "./setup";
import { tokenStore } from "./token-store";
import { WhoopClient } from "./whoop-client";
import { authorizeUrl, eightCharState, exchangeCode, ownerCheck, revokeAccess } from "./whoop-oauth";
import {
	addApprovedClient,
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env }>();

const callbackUrl = (req: Request) => new URL("/callback", req.url).href;

async function redirectToWhoop(c: { env: Env; req: { raw: Request } }, oauthReqInfo: AuthRequest, extra: Headers) {
	const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV, 600, eightCharState);
	const { setCookie } = await bindStateToSession(stateToken);
	extra.append("Set-Cookie", setCookie);
	extra.set("Location", authorizeUrl(c.env.WHOOP_CLIENT_ID, callbackUrl(c.req.raw), stateToken));
	return new Response(null, { status: 302, headers: extra });
}

app.get("/authorize", async (c) => {
	if (!setupState(c.env).clientConfigured) return c.redirect("/", 302);
	let oauthReqInfo: AuthRequest;
	try {
		oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	} catch (e) {
		return c.text(`Invalid authorization request: ${(e as Error)?.message ?? "unknown"}`, 400);
	}
	if (!oauthReqInfo.clientId) return c.text("Invalid request", 400);

	if (await isClientApproved(c.req.raw, oauthReqInfo.clientId, await cookieKey(c.env))) {
		return redirectToWhoop(c, oauthReqInfo, new Headers());
	}

	const { token: csrfToken, setCookie } = generateCSRFProtection();
	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId),
		csrfToken,
		server: {
			name: "Personal WHOOP connector",
			description:
				"Read-only access to your own WHOOP recovery, sleep, strain and workout data via the official WHOOP API. Only the configured owner can connect.",
		},
		setCookie,
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	try {
		const formData = await c.req.raw.formData();
		validateCSRFToken(formData, c.req.raw);
		const encodedState = formData.get("state");
		if (typeof encodedState !== "string") return c.text("Missing state", 400);
		let state: { oauthReqInfo?: AuthRequest };
		try {
			state = JSON.parse(atob(encodedState));
		} catch {
			return c.text("Invalid state", 400);
		}
		if (!state.oauthReqInfo?.clientId) return c.text("Invalid request", 400);

		const headers = new Headers();
		headers.append(
			"Set-Cookie",
			await addApprovedClient(c.req.raw, state.oauthReqInfo.clientId, await cookieKey(c.env)),
		);
		return redirectToWhoop(c, state.oauthReqInfo, headers);
	} catch (e) {
		if (e instanceof OAuthError) return e.toResponse();
		console.log(JSON.stringify({ evt: "authorize_post_error", name: (e as Error)?.name }));
		return c.text("Internal server error", 500);
	}
});

app.get("/callback", async (c) => {
	let oauthReqInfo: AuthRequest;
	let clearCookie: string;
	try {
		({ oauthReqInfo, clearCookie } = await validateOAuthState(c.req.raw, c.env.OAUTH_KV));
	} catch (e) {
		if (e instanceof OAuthError) return e.toResponse();
		return c.text("Internal server error", 500);
	}
	if (c.req.query("error")) return c.text(`WHOOP authorization was not granted (${c.req.query("error")}).`, 400);
	const code = c.req.query("code");
	if (!code || !oauthReqInfo.clientId) return c.text("Missing authorization code", 400);

	let tokens;
	try {
		tokens = await exchangeCode({
			code,
			clientId: c.env.WHOOP_CLIENT_ID,
			clientSecret: c.env.WHOOP_CLIENT_SECRET,
			redirectUri: callbackUrl(c.req.raw),
		});
	} catch {
		return c.text("Could not complete WHOOP sign-in. Try connecting again.", 502);
	}

	let profile;
	try {
		profile = await new WhoopClient({ getAccessToken: async () => tokens.access_token }).profile();
	} catch {
		return c.text("Signed in to WHOOP but could not read the profile (is read:profile granted?). Try again.", 502);
	}
	const whoopUserId = String(profile.user_id);

	switch (ownerCheck(whoopUserId, c.env.OWNER_WHOOP_USER_ID)) {
		case "setup":
			await revokeAccess(tokens.access_token);
			return c.html(
				page(
					"Almost done",
					`<h1>Almost done</h1>
					 <p>Your WHOOP user id is <code>${whoopUserId}</code>.</p>
					 <p>Lock this connector to you: run <code>npm run set-owner -- ${whoopUserId}</code> (or add the secret <code>OWNER_WHOOP_USER_ID</code> = <code>${whoopUserId}</code> in the Cloudflare dashboard), then click <strong>Connect</strong> again in Claude.</p>
					 <p>Until then nobody can connect, and nothing was stored.</p>`,
				),
				403,
			);
		case "denied":
			await revokeAccess(tokens.access_token);
			console.log(JSON.stringify({ evt: "non_owner_denied" }));
			return c.html(page("Not authorized", "<h1>Not authorized</h1><p>This is a private single-user connector.</p>"), 403);
		case "owner":
			break;
	}

	await tokenStore(c.env).saveTokens(whoopUserId, tokens);

	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		request: oauthReqInfo,
		// No ":" here: workers-oauth-provider encodes codes/tokens as "userId:grantId:secret".
		userId: `whoop-${whoopUserId}`,
		metadata: { label: profile.first_name },
		scope: oauthReqInfo.scope,
		props: { whoopUserId } satisfies Props,
	});
	const headers = new Headers({ Location: redirectTo });
	if (clearCookie) headers.set("Set-Cookie", clearCookie);
	return new Response(null, { status: 302, headers });
});

app.get("/privacy", (c) =>
	c.html(
		page(
			"Privacy policy",
			`<h1>Privacy policy</h1>
			 <p>This is a private, single-user connector that lets its owner read their own WHOOP data inside their own Claude account.</p>
			 <ul>
			 <li>Data accessed (read-only, official WHOOP API v2): profile, body measurements, cycles, recovery, sleep, workouts.</li>
			 <li>Stored: only the owner's WHOOP OAuth tokens, encrypted at rest in Cloudflare Durable Object storage. No WHOOP health data is stored, cached or logged; it is fetched on request and returned to the owner's Claude session.</li>
			 <li>Shared: only with the owner's own Claude account, at the owner's explicit request. Not sold, not used to train models.</li>
			 <li>Revoke anytime: disconnect the connector in Claude, or remove the app in the WHOOP app's connected-apps settings.</li>
			 <li>Not affiliated with or endorsed by WHOOP.</li>
			 </ul>`,
		),
	),
);

app.get("/", (c) => c.html(setupPage(new URL(c.req.url).origin, setupState(c.env))));

export { app as WhoopHandler };
