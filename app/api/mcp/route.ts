import { resolveCredential } from "@/lib/security/credentials";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerZhiprismTools, SERVER_INFO, SERVER_INSTRUCTIONS } from "@/lib/mcp/tools";
import { registerWidgetResources } from "@/lib/mcp/widgets";
import { connectorUrls, markConnectorUsed, resolveConnectorToken } from "@/lib/connectors/oauth";
import { oauthError } from "@/lib/connectors/http";

export const runtime = "nodejs";
// get_daily_feed 首次生成 20-40 秒，deep 话题更久；Vercel Fluid compute 下 300 秒够用
export const maxDuration = 300;

function identity(ctx: unknown) {
  return (ctx as { http?: { authInfo?: { extra?: Record<string, unknown> } } }).http?.authInfo?.extra;
}

const handler = createMcpHandler(
  (server) => {
    registerZhiprismTools(server, (ctx) => {
      const info = identity(ctx);
      if (typeof info?.userId !== "string") return null;
      return { userId: info.userId, grantId: typeof info.grantId === "string" ? info.grantId : null };
    }, async (ctx) => {
      const info = identity(ctx);
      if (typeof info?.grantId === "string" && typeof info?.userId === "string") await markConnectorUsed(info.grantId, info.userId);
    });
    registerWidgetResources(server);
  },
  {
    serverInfo: { ...SERVER_INFO },
    instructions: SERVER_INSTRUCTIONS,
    capabilities: { tools: {} },
  },
);

async function authed(request: Request) {
  try {
    const { issuer } = connectorUrls();
    const response = await withMcpAuth(handler, async (_request, bearer) => {
      const token = bearer?.trim();
      const connection = await resolveConnectorToken(token);
      if (connection) return { token: token!, clientId: connection.clientId, scopes: connection.scopes,
        expiresAt: connection.expiresAt, extra: { userId: connection.userId, grantId: connection.grantId } };
      const userId = await resolveCredential(token, "mcp");
      if (!userId) return undefined;
      return { token: token!, clientId: userId, scopes: ["zhiprism"], extra: { userId } };
    // mcp-handler 2.1 concatenates this base with resourceMetadataPath.
    }, { required: true, requiredScopes: ["zhiprism"], resourceUrl: issuer,
      resourceMetadataPath: "/.well-known/oauth-protected-resource" })(request);
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Session-Id");
    return response;
  } catch (error) { return oauthError(error); }
}

export { authed as GET, authed as POST, authed as DELETE };
export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version, MCP-Session-Id",
    "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id" } });
}
