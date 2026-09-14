import { connectorUrls } from "@/lib/connectors/oauth";
import { discoveryResponse, oauthError, oauthOptions } from "@/lib/connectors/http";
import { IDENTITY, MCP_PROTOCOL_VERSION } from "@/lib/mcp/instructions";
import { SERVER_INFO } from "@/lib/mcp/tools";

export function GET() {
  try {
    const { issuer, resource } = connectorUrls();
    const card = {
      serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version, title: SERVER_INFO.title, description: IDENTITY },
      protocolVersion: MCP_PROTOCOL_VERSION,
      transports: [{ type: "streamable-http", endpoint: resource }],
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
      authentication: {
        protectedResourceMetadata: `${issuer}/.well-known/oauth-protected-resource/api/mcp`,
        authorizationServerMetadata: `${issuer}/.well-known/oauth-authorization-server`,
      },
      documentation: `${issuer}/llms.txt`,
    };
    return discoveryResponse(JSON.stringify(card, null, 2), "application/mcp-server-card+json; charset=utf-8");
  } catch (error) { return oauthError(error); }
}
export const OPTIONS = oauthOptions;
