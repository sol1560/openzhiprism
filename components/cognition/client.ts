"use client";
import { useRef } from "react";
export async function cognitionJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "暂时无法完成操作");
  return result as T;
}
/** Retry the same operation with the same key after an uncertain network result. */
export function useRequestId() {
  const last = useRef({ key: "", id: "" });
  return (value: unknown) => {
    const key = JSON.stringify(value);
    if (last.current.key !== key) last.current = { key, id: crypto.randomUUID() };
    return last.current.id;
  };
}
