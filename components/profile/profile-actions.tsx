"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@heroui/react";
import { Plus, RotateCcw } from "lucide-react";

export function ProfileActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    if (!window.confirm("清空当前用户的兴趣画像、导入的对话记录与 Feed？已确认的判断会保留，可在“我的判断”中单独删除。")) return;
    setBusy(true);
    await fetch("/api/profile/reset", { method: "POST" });
    setBusy(false);
    router.push("/onboarding");
    router.refresh();
  };

  return (
    <div className="product-heading-actions">
      <Link href="/onboarding" className="pill-button pill-secondary pill-small">
        <Plus size={14} />
        继续接入对话
      </Link>
      <button type="button" className="text-control text-control-danger" disabled={busy} onClick={reset}>
        {busy ? <Spinner size="sm" color="current" /> : <RotateCcw size={14} />}
        清空画像
      </button>
    </div>
  );
}
