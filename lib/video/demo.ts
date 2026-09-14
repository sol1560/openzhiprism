// 演示视频托管在 Cloudflare Stream；customer code 与视频 UID 都是公开值，按项目惯例写成常量。
export const STREAM_CUSTOMER_CODE = "7636uvdlzcshihj6";

export type DemoLang = "zh" | "en";

export interface DemoVideo { id: DemoLang; label: string; title: string; uid: string }

export const DEMO_VIDEOS: readonly DemoVideo[] = [
  { id: "zh", label: "中文", title: "知棱 ZhiPrism 演示（中文）", uid: "e340ecaa33ca08ac32d38e0f6e8a05c2" },
  { id: "en", label: "English", title: "ZhiPrism Demo (English)", uid: "3f4d14005fc61343bf6aa7d2cd2f959f" },
];

export function streamEmbedUrl(uid: string): string {
  return `https://customer-${STREAM_CUSTOMER_CODE}.cloudflarestream.com/${uid}/iframe?preload=metadata`;
}
