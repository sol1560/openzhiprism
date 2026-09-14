import type { Db } from "@/db";
import type { DailyBrief, FeedView } from "@/lib/feed/types";
import { topicsMatch } from "@/lib/profile/merge";
import { getReflections } from "./reflections";
import { sourceIdentity } from "./evidence";
import { getArtifact } from "./dossiers";

/** Compare actual newly fetched versions; never infer that the user's mind changed. */
export async function readingFollowups(feed: FeedView, database?: Db): Promise<NonNullable<DailyBrief["followups"]>> {
  const followed = (await getReflections(feed.userId, {}, database)).filter((r) => r.following && r.versions[0]?.openQuestions.length).slice(0, 12);
  const out: NonNullable<DailyBrief["followups"]> = [];
  for (const reflection of followed) {
    const version = reflection.versions[0];
    const original = await getArtifact(feed.userId, reflection.jobId, version.dossierId, database);
    const previous = new Map(original.sources.map((s) => [s.identity ?? sourceIdentity({ id: s.contentId, url: s.url }), s.hash]));
    const fresh = feed.cards.filter((card) => {
      const c = card.content;
      if (!c || ["irrelevant", "misleading", "known"].includes(card.feedback ?? "") || !topicsMatch(reflection.topic, card.topicName ?? c.title)) return false;
      const identity = sourceIdentity(c);
      return !previous.has(identity) || Boolean(c.evidenceSourceVersion && previous.get(identity) !== c.evidenceSourceVersion);
    });
    if (fresh.length) out.push({ reflectionId: reflection.id, jobId: reflection.jobId, topic: reflection.topic, question: version.openQuestions[0], titles: fresh.slice(0, 3).map((c) => c.content!.title) });
    if (out.length >= 2) break;
  }
  return out;
}
