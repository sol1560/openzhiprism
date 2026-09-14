import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ParsedConversation } from "@/lib/ingest/parse";

export interface Persona {
  id: string;
  name: string;
  tagline: string;
  avatarSeed: string;
  expectedTopics: string[];
  conversations: ParsedConversation[];
}

const PERSONA_DIR = path.resolve(process.cwd(), "fixtures", "personas");

export async function listPersonas(): Promise<Persona[]> {
  const files = (await readdir(PERSONA_DIR)).filter((file) => file.endsWith(".json")).sort();
  const personas: Persona[] = [];
  for (const file of files) {
    try {
      personas.push(JSON.parse(await readFile(path.join(PERSONA_DIR, file), "utf8")) as Persona);
    } catch {
      // 忽略损坏文件
    }
  }
  return personas;
}

export async function getPersona(id: string): Promise<Persona | null> {
  const personas = await listPersonas();
  return personas.find((persona) => persona.id === id) ?? null;
}

/** 给前端展示用的精简版（不含对话正文） */
export function personaSummary(persona: Persona) {
  return {
    id: persona.id,
    name: persona.name,
    tagline: persona.tagline,
    avatarSeed: persona.avatarSeed,
    expectedTopics: persona.expectedTopics,
    conversationCount: persona.conversations.length,
    messageCount: persona.conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0),
  };
}

export type PersonaSummary = ReturnType<typeof personaSummary>;
