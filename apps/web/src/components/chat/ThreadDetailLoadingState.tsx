import { cn } from "~/lib/utils";
import { Skeleton } from "../ui/skeleton";

export function ThreadDetailLoadingState({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col px-4 py-6 sm:px-8 sm:py-8", className)}
      role="status"
      aria-live="polite"
      aria-label="Loading thread"
    >
      <span className="sr-only">Loading thread</span>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8" aria-hidden="true">
        <div className="flex justify-end">
          <div className="w-full max-w-[72%] space-y-2 rounded-2xl border border-border/35 p-4">
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-7/12" />
          </div>
        </div>
        <div className="w-full max-w-[82%] space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-10/12" />
          <Skeleton className="h-3 w-8/12" />
        </div>
      </div>
    </div>
  );
}
