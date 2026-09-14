import { captureAuth, captureError, captureJson, captureOptions } from "@/lib/extension/http";
import { getUser } from "@/lib/profile/store";
export const OPTIONS = captureOptions;
export async function GET(request: Request) {
  try {
    const auth = await captureAuth(request), user = await getUser(auth.userId);
    return captureJson({ id: auth.userId, name: user?.email ?? user?.displayName ?? "知棱用户" });
  } catch (error) { return captureError(error); }
}
