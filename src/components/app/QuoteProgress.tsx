/**
 * Where an estimate is in its life, as a row of steps under its title.
 *
 * The status badge says what it is; this says what comes next and what is
 * already behind it — which is the question somebody opening an estimate
 * they did not write is actually asking.
 */
import { Check, X } from "lucide-react";
import type { QuoteStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type StepState = "done" | "current" | "failed" | "upcoming";

const STEPS = ["Draft", "Approval", "Sent", "Accepted"] as const;

/** Each status, as the state of each of the four steps and what the failed one should be called. */
const PROGRESS: Record<QuoteStatus, { states: StepState[]; failed?: string }> = {
  draft: { states: ["current", "upcoming", "upcoming", "upcoming"] },
  rejected: { states: ["current", "failed", "upcoming", "upcoming"], failed: "Rejected" },
  in_review: { states: ["done", "current", "upcoming", "upcoming"] },
  approved: { states: ["done", "done", "current", "upcoming"] },
  sent: { states: ["done", "done", "done", "current"] },
  accepted: { states: ["done", "done", "done", "done"] },
  declined: { states: ["done", "done", "done", "failed"], failed: "Declined" },
  expired: { states: ["done", "done", "done", "failed"], failed: "Expired" },
};

export function QuoteProgress({ status }: { status: QuoteStatus }) {
  const { states, failed } = PROGRESS[status] ?? PROGRESS.draft;

  return (
    <ol aria-label="Progress" className="flex items-center gap-1 overflow-x-auto text-xs">
      {STEPS.map((step, index) => {
        const state = states[index]!;
        return (
          <li key={step} className="flex shrink-0 items-center gap-1" aria-current={state === "current" ? "step" : undefined}>
            {index > 0 && (
              <span aria-hidden="true" className={cn("h-px w-6 sm:w-10", state === "upcoming" ? "bg-border" : "bg-primary/50")} />
            )}
            <span
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5",
                state === "done" && "border-transparent bg-primary/10 text-primary",
                state === "current" && "border-primary font-medium text-foreground",
                state === "failed" && "border-transparent bg-flare/10 text-flare",
                state === "upcoming" && "border-dashed text-muted-foreground",
              )}
            >
              {state === "done" && <Check className="size-3" />}
              {state === "failed" && <X className="size-3" />}
              {state === "failed" && failed ? failed : step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
