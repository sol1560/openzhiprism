import { exchangeToken } from "@/lib/connectors/oauth";
import { limitOAuth, oauthError, oauthJson, oauthOptions, readOAuthBody } from "@/lib/connectors/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await limitOAuth("token");
    const params = await readOAuthBody(request, "form") as URLSearchParams;
    return oauthJson(await exchangeToken(params, request.headers.get("authorization")));
  } catch (error) { return oauthError(error); }
}
export const OPTIONS = oauthOptions;
