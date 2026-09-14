/** Only known product destinations and opaque server-side consent requests may resume login. */
export function safeReturnTo(value: unknown): string | undefined {
  if (value === "/connect") return value;
  if (typeof value !== "string" || !/^\/connect\/authorize\?request=[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
  return value;
}
