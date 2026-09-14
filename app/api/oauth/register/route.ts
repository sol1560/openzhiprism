import { registerClient } from "@/lib/connectors/oauth";
import { limitOAuth, oauthError, oauthJson, oauthOptions, readOAuthBody } from "@/lib/connectors/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { await limitOAuth("register"); return oauthJson(await registerClient(await readOAuthBody(request, "json")), 201); }
  catch (error) { return oauthError(error); }
}
export const OPTIONS = oauthOptions;
