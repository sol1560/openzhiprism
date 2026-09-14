import type { NextRequest } from "next/server";
import { getReflections, manageReflection, manageReflectionSchema, reflectionExport } from "@/lib/cognition/reflections";
import { cognitionFailure, cognitionUser, PRIVATE_HEADERS } from "@/lib/cognition/http";
import { CognitionError } from "@/lib/cognition/types";
export async function GET(request: NextRequest) {
  try {
    const user = await cognitionUser(); const id = request.nextUrl.searchParams.get("id") ?? undefined;
    const format = request.nextUrl.searchParams.get("format");
    if (format) {
      if (!id || !["md", "html"].includes(format)) throw new CognitionError("导出参数不正确");
      const text = await reflectionExport(user, id, format as "md" | "html");
      return new Response(text, { headers: { ...PRIVATE_HEADERS, "Content-Type": format === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
    }
    return Response.json({ reflections: await getReflections(user, { id, topic: request.nextUrl.searchParams.get("topic") ?? undefined }) }, { headers: PRIVATE_HEADERS });
  } catch (error) { return cognitionFailure(error); }
}
export async function POST(request: Request) {
  try { const user = await cognitionUser(request, "reflection"); const input = manageReflectionSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new CognitionError("请确认判断内容与当前版本后保存");
    return Response.json(await manageReflection(user, input.data), { headers: PRIVATE_HEADERS });
  } catch (error) { return cognitionFailure(error); }
}
