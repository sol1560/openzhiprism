import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/connectors/oauth";

const LAST_MODIFIED = new Date("2026-09-12T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return [
    { url: `${origin}/`, lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/connect`, lastModified: LAST_MODIFIED, changeFrequency: "weekly", priority: 0.8 },
    { url: `${origin}/video`, lastModified: LAST_MODIFIED, changeFrequency: "monthly", priority: 0.8 },
  ];
}
