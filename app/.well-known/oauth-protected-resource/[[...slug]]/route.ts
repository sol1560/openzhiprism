import { connectorUrls, CONNECTOR_SCOPE } from "@/lib/connectors/oauth";
import { DISCOVERY_HEADERS, oauthError, oauthOptions } from "@/lib/connectors/http";
export async function GET(_request: Request, context: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await context.params;
  if (slug && slug.join("/") !== "api/mcp") return new Response(null, { status: 404 });
  try {
    const { issuer, resource } = connectorUrls();
    return Response.json({ resource, authorization_servers: [issuer], scopes_supported: [CONNECTOR_SCOPE],
      bearer_methods_supported: ["header"], resource_name: "知棱 ZhiPrism" }, { headers: DISCOVERY_HEADERS });
  } catch (error) { return oauthError(error); }
}
export const OPTIONS = oauthOptions;
