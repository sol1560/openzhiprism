import { revokeOAuthToken } from "@/lib/connectors/oauth";
import { limitOAuth, oauthError, oauthJson, oauthOptions, readOAuthBody } from "@/lib/connectors/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await limitOAuth("token");
    await revokeOAuthToken(await readOAuthBody(request, "form") as URLSearchParams, request.headers.get("authorization"));
    return oauthJson({});
  } catch (error) { return oauthError(error); }
}
export const OPTIONS = oauthOptions;
