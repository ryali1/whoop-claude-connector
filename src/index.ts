import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import type { Env, Props } from "./env";
import { ReauthRequired } from "./tokens";
import { tokenStore } from "./token-store";
import { registerTools } from "./tools";
import { WhoopClient } from "./whoop-client";
import { WhoopHandler } from "./whoop-handler";

export { WhoopTokenStore } from "./token-store";

export class WhoopMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({ name: "whoop", version: "0.1.0" });

	async init() {
		registerTools(this.server, async () => {
			// Re-check the owner on every call, not just at connect time.
			const owner = this.env.OWNER_WHOOP_USER_ID?.trim();
			if (!owner || this.props?.whoopUserId !== owner) throw new ReauthRequired();
			const store = tokenStore(this.env);
			return new WhoopClient({ getAccessToken: (stale) => store.getAccessToken(stale) });
		});
	}
}

export default new OAuthProvider({
	apiRoute: "/mcp",
	apiHandler: WhoopMCP.serve("/mcp"),
	defaultHandler: WhoopHandler as any,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	allowPlainPKCE: false,
	// claude.ai refreshes its MCP token on use; 90 days of headroom survives a few skipped weekly check-ins.
	refreshTokenTTL: 90 * 86_400,
});
