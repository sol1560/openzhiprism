import { AmbientLight } from "@/components/ambient-light";
import { AppNav } from "@/components/app-nav";
import { Skeleton } from "@/components/ui-primitives";

export default function OnboardingLoading() {
  return (
    <>
      <AppNav user={null} pending="product" />
      <main className="onboarding-shell" aria-busy="true">
        <AmbientLight />
        <div className="onboarding-inner">
          <div className="mb-10 flex items-center justify-center gap-6">
            <Skeleton className="h-8 w-40 rounded-full" />
            <Skeleton className="h-8 w-40 rounded-full" />
          </div>
          <div className="onboarding-card surface-stack">
            <Skeleton className="h-8 w-2/5 rounded-md" />
            <Skeleton className="h-4 w-4/5 rounded-full" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <div className="flex gap-3">
              <Skeleton className="h-10 w-32 rounded-full" />
              <Skeleton className="h-10 w-28 rounded-full" />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
