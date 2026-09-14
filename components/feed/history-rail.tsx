import Link from "next/link";
import type { HistorySignals } from "@/lib/feed/types";

function relativeDay(iso: string, today: string): string {
  const day = iso.slice(0, 10);
  if (day === today) return "今天";
  const [y, m, d] = day.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const diff = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86_400_000);
  if (diff === 1) return "昨天";
  if (diff > 1 && diff < 7) return `${diff} 天前`;
  return `${m}月${d}日`;
}

/** 侧栏「往日」：可回看的日期 + 最近打开的内容。没有历史时不渲染。 */
export function HistoryRail({ dates, current, today, history }: { dates: string[]; current: string; today: string; history: HistorySignals }) {
  const recent = history.recentOpened.slice(0, 5);
  if (dates.length <= 1 && recent.length === 0) return null;
  return (
    <section className="product-surface history-rail" aria-label="往日与最近打开">
      <div className="history-rail-head">
        <h2 className="sidebar-title" style={{ marginBottom: 0 }}>往日</h2>
        {history.streakDays > 1 ? <span className="history-streak">连续 {history.streakDays} 天</span> : null}
      </div>
      {dates.length > 0 ? (
        <ul className="history-dates">
          {dates.slice(0, 7).map((date) => (
            <li key={date}>
              <Link href={date === today ? "/feed" : `/feed?date=${date}`} aria-current={date === current ? "page" : undefined}>
                <span>{relativeDay(date, today)}</span>
                <span className="history-date-key">{date.slice(5)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {recent.length > 0 ? (
        <>
          <h3 className="history-subtitle">最近打开</h3>
          <ul className="recent-opened">
            {recent.map((item) => (
              <li key={item.contentId}>
                <a href={item.url || undefined} target="_blank" rel="noopener noreferrer">{item.title}</a>
                <div className="recent-opened-meta">
                  {item.topicName ? <span className="topic-label">{item.topicName}</span> : <span className="topic-label topic-label-warm">换换脑子</span>}
                  <span>{relativeDay(item.seenAt, today)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
