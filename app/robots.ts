import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/connectors/oauth";

const AI_BOTS = ["GPTBot", "OAI-SearchBot", "Claude-Web", "Google-Extended", "Amazonbot", "anthropic-ai", "Bytespider", "CCBot", "Applebot-Extended"] as const;
const ALLOW = ["/", "/connect", "/video", "/llms.txt", "/.well-known/", "/api/mcp"];
const DISALLOW = ["/api/", "/feed", "/topics", "/reflections", "/profile", "/onboarding", "/login", "/connect/authorize"];
const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=no";

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  const rule = (userAgent: string) => ({ userAgent, allow: ALLOW, disallow: DISALLOW, other: { "Content-Signal": CONTENT_SIGNAL } });
  return { rules: [rule("*"), ...AI_BOTS.map(rule)], sitemap: `${origin}/sitemap.xml`, host: origin };
}
