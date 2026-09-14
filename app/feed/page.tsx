import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { FeedStream } from "@/components/feed/feed-stream";
import { cognitionEnabled } from "@/lib/cognition/types";
import { env } from "@/lib/env";
import { getBuildStatus, getDailyBrief, getFeed, getHistorySignals, listDirectives, listFeedDates } from "@/lib/feed";
import { describeLlm } from "@/lib/llm/client";
import { getProfile } from "@/lib/profile/store";
import { getSessionUser } from "@/lib/session";
import { todayKey } from "@/lib/zhihu/text";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function FeedPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const today = todayKey();
  const { date: requested } = await searchParams;
  // 只允许回看今天及之前；服务端本地日期为准，客户端只显示 feed.date
  const date = requested && DATE.test(requested) && requested <= today ? requested : today;
  // 数据源额度查询会打外部 HTTP，不放在渲染路径上；侧栏展开时再由客户端请求 /api/status
  const [feed, topics, build, dates, history, brief, directives] = await Promise.all([
    getFeed(user.id, date),
    getProfile(user.id),
    getBuildStatus(user.id, date),
    listFeedDates(user.id),
    getHistorySignals(user.id, { date }),
    getDailyBrief(user.id, date),
    listDirectives(user.id),
  ]);
  return (
    <>
      <AppNav user={user} />
      <main id="main-content" className="flex-1">
        <FeedStream
          cognition={cognitionEnabled()}
          initialFeed={feed}
          topics={topics}
          initialBuild={build}
          llm={describeLlm()}
          initialBrief={brief}
          history={history}
          dates={dates}
          today={today}
          readOnly={date !== today}
          voiceEnabled={env.voiceGuideEnabled}
          initialDirectives={directives}
        />
      </main>
    </>
  );
}
