import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /api/mcp 运行时从磁盘读卡片 HTML 与（应急迁移用的）drizzle 目录；fixture 内容源也读磁盘。
  // 不声明的话 Vercel 的 serverless 追踪会漏掉这些文件。
  outputFileTracingIncludes: {
    "/api/mcp": ["./widgets/dist/**/*", "./drizzle/**/*", "./fixtures/zhihu/**/*"],
    "/api/**": ["./drizzle/**/*", "./fixtures/zhihu/**/*"],
    "/feed": ["./fixtures/zhihu/**/*"],
  },
};

export default nextConfig;
