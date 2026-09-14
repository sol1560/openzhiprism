import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { LoginPanel } from "@/components/auth/login-panel";
import { postLoginDestination } from "@/lib/auth/destination";
import { mailReadiness } from "@/lib/auth/email";
import { googleReadiness } from "@/lib/auth/google";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/session";
import { safeReturnTo } from "@/lib/auth/return-to";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const returnTo = safeReturnTo(next);
  const user = await getSessionUser();
  if (user) redirect(returnTo ?? await postLoginDestination(user.id));
  return <>
    <AppNav user={null} />
    <main id="main-content" className="product-page flex items-center justify-center">
      <LoginPanel googleReady={googleReadiness().ready} mailReady={mailReadiness().ready} devMode={!env.publicMode} initialError={error} returnTo={returnTo} />
    </main>
  </>;
}
