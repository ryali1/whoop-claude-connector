import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { WhoopTokenStore } from "./token-store";

export interface Env {
	OAUTH_KV: KVNamespace;
	MCP_OBJECT: DurableObjectNamespace;
	WHOOP_TOKENS: DurableObjectNamespace<WhoopTokenStore>;
	WHOOP_CLIENT_ID: string;
	WHOOP_CLIENT_SECRET: string;
	/** Optional: auto-generated and kept in KV when unset. */
	COOKIE_ENCRYPTION_KEY?: string;
	/** WHOOP numeric user id allowed to connect. Unset = setup mode (nobody is authorized). */
	OWNER_WHOOP_USER_ID?: string;
	OAUTH_PROVIDER: OAuthHelpers;
}

/** Props sealed into the MCP access token by workers-oauth-provider. */
export interface Props extends Record<string, unknown> {
	whoopUserId: string;
}
