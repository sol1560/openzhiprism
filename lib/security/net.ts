import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

/**
 * 服务端向外抓取 JSON 的安全通道（目前只给 CIMD 客户端元数据用）：
 * 仅 HTTPS、DNS 只解析一次且所有答案必须是公网地址、连接钉到一个地址（TLS/SNI 仍用主机名）、
 * 拒绝重定向、限长限时。优先钉 IPv4：Vercel/AWS Lambda 没有 IPv6 出口，双栈主机（如 claude.ai）
 * 的 AAAA 排在前面时会直接 socket 失败。
 */

export class NetError extends Error {
  constructor(public reason: string) { super(reason); }
}

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? numbers : null;
}

function ipv6Bytes(ip: string): number[] | null {
  let text = ip;
  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (embedded) {
    const parts = ipv4Parts(embedded[1]);
    if (!parts) return null;
    text = text.slice(0, -embedded[1].length) + ((parts[0] << 8) | parts[1]).toString(16) + ":" + ((parts[2] << 8) | parts[3]).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (chunk: string) => chunk === "" ? [] : chunk.split(":").map((h) => (/^[0-9a-f]{1,4}$/i.test(h) ? parseInt(h, 16) : NaN));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((n) => Number.isNaN(n))) return null;
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const words = [...head, ...new Array<number>(Math.max(missing, 0)).fill(0), ...rest];
  return words.flatMap((w) => [w >> 8, w & 0xff]);
}

function hasPrefix(bytes: number[], network: number[], bits: number): boolean {
  const whole = Math.floor(bits / 8);
  for (let i = 0; i < whole; i += 1) if (bytes[i] !== network[i]) return false;
  const rem = bits % 8;
  if (!rem) return true;
  const mask = (0xff << (8 - rem)) & 0xff;
  return (bytes[whole] & mask) === ((network[whole] ?? 0) & mask);
}

function isPublicIpv4(ip: string): boolean {
  const parts = ipv4Parts(ip);
  if (!parts) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) || a >= 224);
}

function isPublicIpv6(ip: string): boolean {
  const bytes = ipv6Bytes(ip);
  if (!bytes) return false;
  if (hasPrefix(bytes, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96)) return isPublicIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  if (!hasPrefix(bytes, [0x20], 3)) return false; // ::、ULA、链路本地、组播全部排除
  if (hasPrefix(bytes, [0x20, 0x01, 0x00], 23)) return false; // IETF 特殊用途
  if (hasPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)) return false; // 文档段
  if (hasPrefix(bytes, [0x20, 0x02], 16)) return false; // 6to4
  if (hasPrefix(bytes, [0x3f, 0xff, 0x00], 20)) return false; // 文档段
  return true;
}

/** 只有全球可路由的单播地址返回 true。 */
export function isPublicIp(ip: string): boolean {
  const normalized = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const family = isIP(normalized);
  return family === 4 ? isPublicIpv4(normalized) : family === 6 ? isPublicIpv6(normalized) : false;
}

const JSON_TYPE = /^application\/(?:[-\w.]+\+)?json\s*(?:;|$)/i;

export interface PublicJson { json: unknown; cacheControl: string }

export async function fetchPublicJson(url: URL, { maxBytes = 8192, timeoutMs = 5000 } = {}): Promise<PublicJson> {
  if (url.protocol !== "https:") throw new NetError("仅支持 HTTPS");
  if (url.username || url.password) throw new NetError("地址不能携带凭证");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) throw new NetError("必须使用域名");
  const answers = await lookup(hostname, { all: true, verbatim: true }).catch(() => { throw new NetError("DNS 解析失败"); });
  if (!answers.length) throw new NetError("DNS 无结果");
  if (answers.some((answer) => !isPublicIp(answer.address))) throw new NetError("地址不是公网地址");
  const pinned = answers.find((answer) => answer.family === 4) ?? answers[0];
  return new Promise<PublicJson>((resolve, reject) => {
    const req = request(url, {
      agent: false, method: "GET", servername: hostname, signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json", host: url.host, "user-agent": "zhiprism-connector/1.0" },
      lookup: (_hostname, options, callback) => {
        // 新版 Node 以 {all:true} 调用并期待数组，旧版期待标量；两种都兼容。
        if ((options as { all?: boolean } | undefined)?.all) {
          (callback as unknown as (error: null, addresses: unknown) => void)(null, [{ address: pinned.address, family: pinned.family }]);
        } else callback(null, pinned.address as never, pinned.family as never);
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const type = String(response.headers["content-type"] ?? "");
      if (status >= 300 && status < 400) { response.resume(); return reject(new NetError("不允许重定向")); }
      if (status !== 200) { response.resume(); return reject(new NetError(`HTTP ${status}`)); }
      if (!JSON_TYPE.test(type)) { response.resume(); return reject(new NetError("响应不是 JSON")); }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); reject(new NetError(`文档超过 ${maxBytes} 字节`)); return; }
        chunks.push(chunk);
      });
      response.on("error", () => reject(new NetError("读取响应失败")));
      response.on("end", () => {
        try { resolve({ json: JSON.parse(Buffer.concat(chunks).toString("utf8")), cacheControl: String(response.headers["cache-control"] ?? "") }); }
        catch { reject(new NetError("不是合法 JSON")); }
      });
    });
    req.once("error", (error: Error & { name?: string }) => reject(new NetError(error.name === "AbortError" || error.name === "TimeoutError" ? "请求超时" : "网络错误")));
    req.end();
  });
}
