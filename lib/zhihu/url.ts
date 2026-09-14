import type { ZhihuItem } from "./types";

/** 把内容类型 + id 拼成知乎站内可打开的公开链接 */
export function toPublicUrl(type: ZhihuItem["type"], id: string, questionId?: string): string {
  switch (type) {
    case "answer":
      return questionId
        ? `https://www.zhihu.com/question/${questionId}/answer/${id}`
        : `https://www.zhihu.com/answer/${id}`;
    case "article":
      return `https://zhuanlan.zhihu.com/p/${id}`;
    case "question":
      return `https://www.zhihu.com/question/${id}`;
    case "hot":
      return `https://www.zhihu.com/question/${id}`;
    case "web":
      return id;
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}
