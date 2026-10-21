import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NextStep } from "@bb/domain";
import type { ThreadTimelineViewRow } from "@bb/thread-view";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { getAppSurface } from "@/lib/app-surface";
import { sdk } from "@/lib/sdk";
import {
  applyNextStep,
  nextStepQueryKey,
} from "@/hooks/cache-owners/next-step-cache-owner";

export function useThreadNextStep(
  threadId: string | undefined,
  active: boolean,
) {
  return useQuery({
    queryKey: nextStepQueryKey(threadId),
    queryFn: () => {
      if (threadId === undefined) {
        throw new Error("A thread is required to load its next step.");
      }
      return sdk.threads.experimental_nextStep(threadId);
    },
    enabled: threadId !== undefined && !active,
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? 30_000 : false,
    retry: false,
  });
}

export function nextStepRowId(
  rows: readonly ThreadTimelineViewRow[],
  suggestion: NextStep | null | undefined,
): string | null {
  if (
    suggestion == null ||
    (suggestion.status !== "proposed" && suggestion.status !== "accepted")
  ) {
    return null;
  }
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row === undefined) continue;
    if (
      suggestion.status === "proposed" &&
      ((row.kind === "conversation" &&
        row.role === "user" &&
        row.initiator === "user" &&
        row.turnRequest.status !== "rejected") ||
        (row.kind === "turn" && row.turnId !== suggestion.turnId))
    ) {
      return null;
    }
    if (
      row.turnId !== suggestion.turnId ||
      (row.kind === "conversation" && row.role === "user")
    ) {
      continue;
    }
    if (row.kind === "turn" && row.status !== "completed") {
      return null;
    }
    return row.id;
  }
  return null;
}

function sourceLabel(evidence: NextStep["evidence"][number]): string {
  switch (evidence.source) {
    case "conversation":
      return "from this conversation";
    case "file":
      return `from ${evidence.ref}`;
    case "commit":
      return `from commit ${evidence.ref.slice(0, 7)}`;
    case "ci_run":
      return "from CI";
    case "issue":
      return "from an issue";
    case "pull_request":
      return "from a pull request";
  }
}

export function nextStepReminderLabel(
  runAt: number,
  timezone: string,
  now = Date.now(),
): string {
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dayFormatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const date = Number(parts.find((part) => part.type === "day")?.value);
  const tomorrow = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Date.UTC(year, month - 1, date + 1));
  const day =
    dayFormatter.format(runAt) === tomorrow
      ? "tomorrow"
      : new Intl.DateTimeFormat(undefined, {
          timeZone: timezone,
          month: "short",
          day: "numeric",
        }).format(runAt);
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(runAt)
    .replace(/^0/, "");
  return `Result reminder ${day} at ${time}, or when you return`;
}

function useNextStepImpression(suggestion: NextStep) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (
      element === null ||
      suggestion.status !== "proposed" ||
      suggestion.shownAt !== null ||
      getAppSurface() === "mobile"
    ) {
      return;
    }
    let visible = false;
    let sent = false;
    const report = () => {
      if (!visible || sent || document.visibilityState !== "visible") {
        return;
      }
      sent = true;
      void sdk.threads
        .experimental_showNextStep(suggestion.threadId)
        .catch(() => {
          sent = false;
        });
    };
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      report();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", report);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", report);
    };
  }, [
    suggestion.id,
    suggestion.shownAt,
    suggestion.status,
    suggestion.threadId,
  ]);
  return ref;
}

export function NextStepRow({ suggestion }: { suggestion: NextStep }) {
  const queryClient = useQueryClient();
  const ref = useNextStepImpression(suggestion);
  const [error, setError] = useState<string | null>(null);
  const action = useMutation({
    mutationFn: (kind: "accept" | "dismiss" | "undo") => {
      setError(null);
      switch (kind) {
        case "accept":
          return sdk.threads.experimental_acceptNextStep(suggestion.threadId);
        case "dismiss":
          return sdk.threads.experimental_dismissNextStep(suggestion.threadId);
        case "undo":
          return sdk.threads.experimental_undoNextStep(suggestion.threadId);
      }
    },
    onSuccess: (nextStep) => {
      applyNextStep({
        queryClient,
        threadId: suggestion.threadId,
        suggestion: nextStep,
      });
    },
    onError: () => {
      setError("Couldn’t update this next step. Try again.");
    },
  });
  const evidence = suggestion.evidence[0];
  const accepted = suggestion.status === "accepted";
  const automation =
    suggestion.action.kind === "automation"
      ? suggestion.action.automation
      : null;

  return (
    <div ref={ref} className="mt-3 px-1" aria-label="Next step">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {accepted ? (
          <>
            <span className="text-muted-foreground" role="status">
              {automation === null
                ? "Work started"
                : nextStepReminderLabel(
                    automation.schedule.runAt,
                    automation.schedule.timezone,
                  )}
            </span>
            {automation !== null ? (
              <>
                <span className="text-muted-foreground" aria-hidden>
                  ·
                </span>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0 py-1"
                  disabled={action.isPending}
                  onClick={() => action.mutate("undo")}
                >
                  Cancel reminder
                </Button>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span>{suggestion.title}</span>
            {evidence !== undefined ? (
              <span className="text-xs text-muted-foreground">
                {sourceLabel(evidence)}
              </span>
            ) : null}
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 py-1"
              disabled={action.isPending}
              onClick={() => action.mutate("accept")}
            >
              {automation === null ? "Start" : "Start now"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground"
              aria-label="Dismiss next step"
              disabled={action.isPending}
              onClick={() => action.mutate("dismiss")}
            >
              <Icon name="X" className="size-3" aria-hidden />
            </Button>
          </>
        )}
      </div>
      {error !== null ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
