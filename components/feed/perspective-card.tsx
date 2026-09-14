"use client";

import { Fragment } from "react";
import { ArrowUpRight, ThumbsUp } from "lucide-react";
import { TopicEntry } from "@/components/cognition/entry";
import { PrismMark } from "@/components/logo";
import type { PerspectiveCard as PerspectiveCardModel } from "@/lib/perspective/types";

const cleanMarkdown = (text: string) => text.replace(/^#+\s*/gm, "").replace(/\*\*/g, "");

/** 「换个角度看」：和普通阅读卡同一套几何，只多一圈暖色边；反方回答常开，不再折叠。 */
export function PerspectiveCard({ card, onOpen, cognition = true }: { card: PerspectiveCardModel; onOpen: (contentId: string) => void; cognition?: boolean }) {
  const counterStance = card.stances.find((stance) => stance.side === card.counterSide);
  const others = card.stances.filter((stance) => stance.side !== card.counterSide);
  const analysisSource = card.analysisModel?.startsWith("zhida") ? "来自知乎直答" : !card.analysisModel || card.analysisModel === "rules" ? "由规则整理" : card.analysisModel;

  return (
    <article className="reading-card prism-border" aria-label="换个角度看">
      <div className="reading-card-meta">
        <span className="warm-label"><PrismMark className="size-4" />换个角度看</span>
        <span className="tag tag-accent">{card.topicName}</span>
      </div>
      <h3>{card.question}</h3>

      <div className="stance-grid">
        {counterStance ? (
          <div className="stance-list">
            <span className="tag tag-accent">{counterStance.label} · 你很少看到的一方</span>
            {counterStance.items.map((item) => (
              <a key={item.id} href={item.url} target="_blank" rel="noreferrer noopener" onClick={() => onOpen(item.id)} className="stance-item">
                <p>{item.oneLine}</p>
                {item.excerpt ? <p className="stance-excerpt">{item.excerpt}</p> : null}
                <small>
                  <span>{item.title}</span>
                  {item.authorName ? <span>{item.authorName}</span> : null}
                  {item.voteUp > 0 ? <span><ThumbsUp size={11} /> {item.voteUp.toLocaleString("zh-CN")}</span> : null}
                  <ArrowUpRight size={12} />
                </small>
              </a>
            ))}
          </div>
        ) : null}

        <div className="stance-list">
          {others.map((stance) => (
            <Fragment key={stance.side}>
              <span className="tag">{stance.label}</span>
              {stance.items.map((item) => (
                <a key={item.id} href={item.url} target="_blank" rel="noreferrer noopener" onClick={() => onOpen(item.id)} className="stance-item stance-item-secondary">
                  <p>{item.oneLine}</p>
                  <small><span>{item.title}</span></small>
                </a>
              ))}
            </Fragment>
          ))}
          {card.analysis ? (
            <div className="stance-analysis">
              <span className="tag">中立看法 · {analysisSource}</span>
              <p>{cleanMarkdown(card.analysis)}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="reading-card-byline">
        <span>看过不代表同意</span>
        {cognition ? <div className="card-actions"><TopicEntry topic={card.question} /></div> : null}
      </div>
    </article>
  );
}
