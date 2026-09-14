"use client";

import { useState } from "react";
import { ChevronDown, MoreHorizontal, ThumbsDown, ThumbsUp, Undo2 } from "lucide-react";
import { FeedbackChoices, TopicEntry, useReadingFeedback } from "@/components/cognition/entry";
import { AiDetection } from "./ai-detection";
import { AskBox } from "./ask-box";
import { SourceBadge } from "@/components/source-badge";
import { ContentCardView } from "@/components/content-card-view";
import type { AskResponse, FeedCard as FeedCardModel } from "@/lib/feed/types";

const CARD_SUGGESTIONS = ["改成三条要点", "用大白话讲", "讲讲论据", "少推这类"];

/**
 * 正式 Feed 的内容卡：署名行只留一行常用操作（有帮助 / 不相关 / 看分歧与依据 / 更多），
 * 提要求、推荐理由、完整反馈和 AI 检测都收进「更多」抽屉，卡片回到阅读优先。
 */
export function FeedContentCard({ card, onOpen, onAsk, onRevert, cognition = true }: {
  card: FeedCardModel;
  cognition?: boolean;
  onOpen: (card: FeedCardModel) => void;
  /** 对这篇提要求；未提供时不显示输入框（例如回看往日） */
  onAsk?: (text: string, cardId: string) => Promise<AskResponse>;
  onRevert?: (cardId: string) => Promise<void>;
}) {
  const [more, setMore] = useState(false);
  const content = card.content;
  const feedback = useReadingFeedback(content?.id ?? "", card.feedback);
  if (!content) return null;

  const summaryNote = card.override ? (
    <div className="summary-note">
      <span>已按你的要求改写{card.override.note ? `：${card.override.note}` : ""}</span>
      {onRevert ? (
        <button type="button" className="summary-note-revert" onClick={() => void onRevert(card.id)}>
          <Undo2 size={12} /> 撤销
        </button>
      ) : null}
    </div>
  ) : null;

  const actions = <>
    {cognition ? <>
      <button type="button" className="text-control" aria-pressed={feedback.value === "useful"} disabled={feedback.busy} onClick={() => void feedback.choose("useful")}><ThumbsUp size={13} />有帮助</button>
      <button type="button" className="text-control" aria-pressed={feedback.value === "irrelevant"} disabled={feedback.busy} onClick={() => void feedback.choose("irrelevant")}><ThumbsDown size={13} />不相关</button>
      <TopicEntry cardId={card.id} />
    </> : null}
    <button type="button" className="text-control" aria-expanded={more} onClick={() => setMore((value) => !value)}>
      <MoreHorizontal size={14} />更多<ChevronDown size={12} />
    </button>
  </>;

  const drawer = more ? (
    <div className="card-drawer">
      {onAsk ? (
        <div className="card-drawer-section">
          <p className="card-drawer-title">对这篇提要求</p>
          <AskBox compact autoFocus placeholder="比如：改短一点、用三条要点、论据是什么" suggestions={CARD_SUGGESTIONS} onAsk={(text) => onAsk(text, card.id)} />
        </div>
      ) : null}
      <div className="card-drawer-section">
        <p className="card-drawer-title">为什么推荐给你</p>
        <p className="card-drawer-reason">{card.reason}</p>
      </div>
      {cognition ? (
        <div className="card-drawer-section">
          <p className="card-drawer-title">这篇对你？</p>
          <FeedbackChoices feedback={feedback} />
          {feedback.value ? <p className="text-xs text-muted">记下了。这只影响推荐，不代表你同意作者。</p> : null}
          {feedback.error ? <p role="alert" className="form-error">{feedback.error}</p> : null}
        </div>
      ) : null}
      {["answer", "article"].includes(content.type) ? <AiDetection key={`${content.id}:${content.sourceVersion}`} contentId={content.id} initial={content.aiDetection} /> : null}
    </div>
  ) : null;

  return <ContentCardView content={content} topic={card.topicName} source={<SourceBadge provider={content.provider} />} seen={card.seen} light={card.kind === "light"} onOpen={() => onOpen(card)} summaryNote={summaryNote} actions={actions} drawer={drawer} />;
}
