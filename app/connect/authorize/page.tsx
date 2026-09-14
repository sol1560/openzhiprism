import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { ConnectorConsent } from "@/components/connect/connector-consent";
import { authorizationRequest, consentPath, requestCookie, extensionResource } from "@/lib/connectors/oauth";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "连接授权 · 知棱", robots: { index: false }, referrer: "no-referrer" as const };

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const id = (await searchParams).request ?? "";
  const pending = await authorizationRequest(id, (await cookies()).get(requestCookie(id))?.value);
  const user = await getSessionUser();
  if (!pending) return <><AppNav user={user} /><main id="main-content" className="product-page consent-page"><section className="product-surface">
    <h1 className="text-2xl font-medium">这次授权已结束</h1><p className="my-5 text-sm leading-loose text-muted">链接已过期、已处理，或不属于当前浏览器。请回到 AI 客户端重新点击连接。</p>
    <Link href="/connect" className="pill-button pill-secondary">查看连接指南</Link>
  </section></main></>;
  if (!user) redirect(`/login?next=${encodeURIComponent(consentPath(id))}`);
  return <><AppNav user={user} /><main id="main-content" className="product-page consent-page">
    <ConnectorConsent requestId={id} clientName={pending.client.name} account={user.email ?? user.displayName}
      extension={pending.request.resource === extensionResource()}
      redirectHost={new URL(pending.request.redirectUri).host} offline={pending.request.scope.split(" ").includes("offline_access")} />
  </main></>;
}
