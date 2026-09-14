import { eq } from "drizzle-orm";
import { db, schema, type Db } from "@/db";
/** 登录后的去处：已有兴趣画像直接看 Feed，否则先接入对话。 */
export async function postLoginDestination(userId: string, database?: Db): Promise<"/feed" | "/onboarding"> {
  const databaseInstance = database ?? await db();
  const [topic] = await databaseInstance.select({ id: schema.interestTopics.id }).from(schema.interestTopics).where(eq(schema.interestTopics.userId, userId)).limit(1);
  return topic ? "/feed" : "/onboarding";
}
