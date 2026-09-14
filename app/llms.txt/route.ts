import { connectorUrls } from "@/lib/connectors/oauth";
import { discoveryResponse, oauthError } from "@/lib/connectors/http";
import { IDENTITY, PRIVACY_LINE, RULES, TOOL_GROUPS } from "@/lib/mcp/instructions";

export const revalidate = 3600;

/** 与 MCP instructions 同源的 Agent 可读说明。 */
export function GET() {
  try {
    const { issuer, resource } = connectorUrls();
    const lines = [
      "# 知棱 ZhiPrism",
      "",
      `> ${IDENTITY}`,
      "",
      "## MCP",
      "",
      "远程 MCP（Streamable HTTP + OAuth 2.1，支持动态注册与客户端元数据文档）。Claude、ChatGPT、Claude Code、Codex、Cursor 直接粘贴连接地址即可。",
      "",
      `- 连接地址：${resource}`,
      `- Server card：${issuer}/.well-known/mcp/server-card.json`,
      `- 受保护资源元数据：${issuer}/.well-known/oauth-protected-resource/api/mcp`,
      `- 授权服务器元数据：${issuer}/.well-known/oauth-authorization-server`,
      "",
      "## 工具分组",
      "",
      ...TOOL_GROUPS.map((group) => `- ${group.label}: ${group.tools.join(", ")}`),
      "",
      "## 调用规则",
      "",
      ...RULES.map((rule) => `- ${rule}`),
      "",
      "## 隐私",
      "",
      PRIVACY_LINE,
      "",
      "## HTML",
      "",
      `- 首页：${issuer}/`,
      `- 接入指南与连接管理：${issuer}/connect`,
      "",
    ];
    return discoveryResponse(lines.join("\n"), "text/plain; charset=utf-8");
  } catch (error) { return oauthError(error); }
}
