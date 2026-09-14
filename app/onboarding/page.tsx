import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AmbientLight } from "@/components/ambient-light";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { cursorInstallUrl } from "@/lib/connectors/clients";
import { connectorUrls } from "@/lib/connectors/oauth";
import { listConversations } from "@/lib/ingest";
import { getProfile } from "@/lib/profile/store";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string; oauth?: string }> }) {
  const [{ step, oauth }, user] = await Promise.all([searchParams, getSessionUser()]);
  if (!user) redirect("/login");
  const [topics, conversations] = await Promise.all([getProfile(user.id), listConversations(user.id, 50)]);
  // 第 2 步的数据来自数据库：刷新、或从知乎 OAuth 回调带 ?step=2 进来都能直接展示
  if (step === "2" && topics.length === 0) redirect(oauth ? `/onboarding?oauth=${encodeURIComponent(oauth)}` : "/onboarding");
  const { issuer, resource } = connectorUrls();
  const host = new URL(issuer).hostname;
  const connect = { endpoint: resource, cursorUrl: cursorInstallUrl(resource),
    localOnly: new URL(issuer).protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(host) };
  const stats = {
    conversationCount: conversations.length,
    messageCount: conversations.reduce((sum, conversation) => sum + conversation.messageCount, 0),
    redactedCount: conversations.reduce((sum, conversation) => sum + conversation.redactedCount, 0),
  };
  return (
    <>
      <AppNav user={user} />
      <main id="main-content" className="onboarding-shell">
        <AmbientLight />
        <OnboardingFlow initialStep={step === "2" ? 1 : 0} topics={topics} stats={stats} oauth={oauth ?? null} connect={connect} />
      </main>
    </>
  );
}
