import { AGENT_NAME, buildAgentBody, buildToolBody } from "../lib/voice/agent-config";
import { VOICE_TOOL_DEFINITIONS } from "../lib/voice/tools";

/**
 * 把「小棱」同步到 ElevenLabs：按名字 upsert client tools，再创建或 PATCH agent。
 *
 *   pnpm voice:sync            # 读取 .env.local 里的 ELEVENLABS_API_KEY / ELEVENLABS_AGENT_ID / ELEVENLABS_VOICE_ID
 *   pnpm voice:sync --dry-run  # 只打印将要提交的 JSON，不联网
 *
 * 首次创建会打印 ELEVENLABS_AGENT_ID=...，请自行贴进 .env.local（脚本不改 env 文件）。
 */

const BASE = process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io";
const dryRun = process.argv.includes("--dry-run");
const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
const agentId = process.env.ELEVENLABS_AGENT_ID?.trim() || undefined;
const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || undefined;

interface ToolRow { id: string; tool_config?: { name?: string } }

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "xi-api-key": apiKey!, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error(`${method} ${path} → ${response.status}\n${text}`);
    process.exit(1);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function main() {
  const toolBodies = VOICE_TOOL_DEFINITIONS.map(buildToolBody);
  if (dryRun) {
    console.log(JSON.stringify({ tools: toolBodies, agent: buildAgentBody({ toolIds: VOICE_TOOL_DEFINITIONS.map((tool) => `<id:${tool.name}>`), voiceId }) }, null, 2));
    return;
  }
  if (!apiKey) {
    console.error("缺少 ELEVENLABS_API_KEY（写在 .env.local 里）");
    process.exit(1);
  }

  // 1. 工具：按名字 upsert，保持与 VOICE_TOOL_DEFINITIONS 一致的顺序
  const listed = await api<{ tools?: ToolRow[] } | ToolRow[]>("GET", "/v1/convai/tools");
  const rows = Array.isArray(listed) ? listed : (listed.tools ?? []);
  const existing = new Map(rows.filter((row) => row.tool_config?.name).map((row) => [row.tool_config!.name!, row.id]));
  const toolIds: string[] = [];
  for (const body of toolBodies) {
    const name = body.tool_config.name;
    const known = existing.get(name);
    if (known) {
      await api("PATCH", `/v1/convai/tools/${known}`, body);
      toolIds.push(known);
      console.log(`tool ${name}: updated (${known})`);
    } else {
      const created = await api<{ id: string }>("POST", "/v1/convai/tools", body);
      toolIds.push(created.id);
      console.log(`tool ${name}: created (${created.id})`);
    }
  }

  // 2. Agent：有 id 就 PATCH，否则创建并打印 id
  const agentBody = buildAgentBody({ toolIds, voiceId });
  if (agentId) {
    await api("PATCH", `/v1/convai/agents/${agentId}`, agentBody);
    console.log(`agent ${AGENT_NAME}: updated (${agentId})`);
  } else {
    const created = await api<{ agent_id: string }>("POST", "/v1/convai/agents/create", agentBody);
    console.log(`agent ${AGENT_NAME}: created`);
    console.log(`\n把下面这行加进 .env.local：\nELEVENLABS_AGENT_ID=${created.agent_id}\n`);
  }
  if (!voiceId) console.log("提示：未设置 ELEVENLABS_VOICE_ID，agent 使用 ElevenLabs 默认声音；建议在 Voice Library 里挑一个支持中文的 voice。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
