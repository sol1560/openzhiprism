import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { TopicWorkspace } from "@/components/cognition/topic-workspace";
import { getDossier } from "@/lib/cognition/dossiers";
import { CognitionError, cognitionEnabled } from "@/lib/cognition/types";
import { getSessionUser } from "@/lib/session";
import { getFeed } from "@/lib/feed";
import { env } from "@/lib/env";
export const dynamic = "force-dynamic";
export default async function TopicPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string; inquiry?: string; from?: string }> }) {
  const user = await getSessionUser(); if (!user) redirect("/login"); if (!cognitionEnabled()) notFound();
  const { id } = await params; const query = await searchParams;
  let initial;
  try { initial = await getDossier(user.id, id, query.version); } catch (e) { if (e instanceof CognitionError && e.status === 404) notFound(); throw e; }
  const feed = await getFeed(user.id);
  return <><AppNav user={user} /><TopicWorkspace initial={initial} version={query.version} inquiryId={query.inquiry} from={query.from} voiceEnabled={env.voiceGuideEnabled} feed={feed} /></>;
}
