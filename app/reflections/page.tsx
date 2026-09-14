import { notFound, redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ReflectionList } from "@/components/cognition/reflection-list";
import { getReflections } from "@/lib/cognition/reflections";
import { cognitionEnabled } from "@/lib/cognition/types";
import { getSessionUser } from "@/lib/session";
export const dynamic = "force-dynamic";
export default async function ReflectionsPage() {
  const user = await getSessionUser(); if (!user) redirect("/login"); if (!cognitionEnabled()) notFound();
  return <><AppNav user={user} /><ReflectionList initial={await getReflections(user.id)} /></>;
}
