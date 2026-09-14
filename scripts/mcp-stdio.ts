/**
 * 知棱 MCP Server（stdio）。供 Claude Desktop / Cursor 等客户端本地拉起。
 *
 *   ZHIPRISM_USER_ID=<用户 id> node --env-file=.env.local --import tsx scripts/mcp-stdio.ts
 *
 * 不设置 ZHIPRISM_USER_ID 时使用固定的 "mcp_local" 用户。
 */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";
import { registerZhiprismTools, SERVER_INFO, SERVER_INSTRUCTIONS } from "@/lib/mcp/tools";
import { registerWidgetResources } from "@/lib/mcp/widgets";

async function main() {
  const userId = process.env.ZHIPRISM_USER_ID?.trim() || "mcp_local";
  const server = new McpServer({ ...SERVER_INFO }, { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {} } });
  registerZhiprismTools(server, () => userId);
  // 客户端可能以任意 cwd 拉起本进程，卡片目录按脚本位置解析
  registerWidgetResources(server, fileURLToPath(new URL("../widgets/dist", import.meta.url)));
  await server.connect(new StdioServerTransport());
  console.error(`[zhiprism] MCP stdio server ready, user=${userId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
