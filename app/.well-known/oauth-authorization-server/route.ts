import { connectorUrls, ALL_OAUTH_SCOPES } from "@/lib/connectors/oauth";
import { DISCOVERY_HEADERS, oauthError, oauthOptions } from "@/lib/connectors/http";
export function GET() {
  try {
    const { issuer } = connectorUrls();
    return Response.json({ issuer, authorization_endpoint: `${issuer}/api/oauth/authorize`, token_endpoint: `${issuer}/api/oauth/token`,
      registration_endpoint: `${issuer}/api/oauth/register`, revocation_endpoint: `${issuer}/api/oauth/revoke`,
      response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
      code_challenge_methods_supported: ["S256"], scopes_supported: ALL_OAUTH_SCOPES.split(" "),
      authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true }, { headers: DISCOVERY_HEADERS });
  } catch (error) { return oauthError(error); }
}
export const OPTIONS = oauthOptions;
