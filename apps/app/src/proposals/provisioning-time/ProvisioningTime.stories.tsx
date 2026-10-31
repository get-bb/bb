import { useEffect, useState, type ReactNode } from "react";
import type { TimelineRow } from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import {
  conversationRow,
  systemRow,
} from "@/test/fixtures/thread-timeline-rows";
import {
  composerPlaceholder,
  ProvisioningRow,
  type ProvisioningRun,
} from "./ProvisioningTime";

export default {
  title: "proposals/Provisioning Time",
};

const THREAD_ID = "thr_k2m9prov01";

const BERTH: ProvisioningRun = {
  usualMs: 31_653,
  slowMs: 62_858,
  steps: [
    { label: "Creating berth", startMs: 0, endMs: 1_001 },
    { label: "Asking berth for a sandbox", startMs: 1_001, endMs: 2_005 },
    { label: "Preparing machine enrollment", startMs: 2_005, endMs: 5_022 },
    { label: "Bootstrapping machine", startMs: 5_022, endMs: 12_993 },
    { label: "Waiting for machine connection", startMs: 12_993, endMs: 13_995 },
    {
      label: "Setting up project on machine",
      startMs: 13_995,
      endMs: 28_579,
      output: [
        { atMs: 1_900, text: "remote: Enumerating objects: 48211, done." },
        {
          atMs: 5_100,
          text: "Receiving objects:  78% (37605/48211), 117.4 MiB | 26.02 MiB/s",
        },
        { atMs: 9_800, text: "Updating files: 100% (2741/2741), done." },
      ],
    },
    {
      label: "Creating branch bb/investigate-slow-dashboard-filters",
      startMs: 28_579,
      endMs: 29_281,
    },
    { label: "Starting Claude Code session", startMs: 29_385, endMs: 32_585 },
  ],
};

const BERTH_SLOW: ProvisioningRun = {
  usualMs: 31_653,
  slowMs: 62_858,
  steps: [
    { label: "Creating berth", startMs: 2_619, endMs: 3_658 },
    { label: "Asking berth for a sandbox", startMs: 3_658, endMs: 11_797 },
    { label: "Bootstrapping machine", startMs: 17_862, endMs: 32_588 },
    {
      label: "Setting up project on machine",
      startMs: 32_588,
      endMs: 73_946,
      output: [{ atMs: 38_900, text: "Resolving deltas:  71% (98114/138190)" }],
    },
    { label: "Running .bb-env-setup.sh", startMs: 73_976, endMs: 109_196 },
    { label: "Starting Claude Code session", startMs: 109_346, endMs: 111_117 },
  ],
};

const BERTH_FAILED: ProvisioningRun = {
  usualMs: 31_653,
  slowMs: 62_858,
  error: "fatal: invalid reference: dev",
  steps: [
    { label: "Bootstrapping machine", startMs: 7_234, endMs: 12_621 },
    { label: "Setting up project on machine", startMs: 13_623, endMs: 38_333 },
    {
      label: "Creating branch bb/investigate-this from dev",
      startMs: 38_333,
      endMs: 38_502,
      failed: true,
    },
  ],
};

const baseTimelineProps = {
  projectId: "proj_demo",
  threadRuntimeDisplayStatus: "provisioning" as const,
  workspaceRootPath: undefined,
};

const userRow: TimelineRow = conversationRow({
  id: `${THREAD_ID}:user:1`,
  role: "user",
  text: "Filters on the orders page take ~4s to apply. Profile the filter pipeline, find what's slow and fix it.",
  threadId: THREAD_ID,
  turnId: "turn-1",
  seq: 2,
});

function legacyRow(status: "pending" | "completed"): TimelineRow {
  return systemRow({
    id: `${THREAD_ID}:op:thread-provisioning:legacy-${status}`,
    threadId: THREAD_ID,
    turnId: null,
    sourceSeqStart: 3,
    sourceSeqEnd: 40,
    startedAt: 1_000,
    createdAt: 33_585,
    systemKind: "operation",
    operationKind: "thread-provisioning",
    title: status === "pending" ? "Provisioning thread" : "Provisioned thread",
    detail:
      "Creating berth…\nBootstrapping machine\nSetting up project on machine",
    status,
    completedAt: status === "pending" ? null : 33_585,
  });
}

function Composer({ placeholder }: { placeholder: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 pb-2.5 pt-3">
      <div className="text-sm text-subtle-foreground">{placeholder}</div>
      <div className="mt-7 flex items-center justify-between text-muted-foreground">
        <span className="flex items-center gap-3 text-sm">
          <Icon name="Plus" className="size-4" aria-hidden />
          Opus 5.5 High
        </span>
        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-subtle-foreground">
          <Icon name="ArrowUp" className="size-4" aria-hidden />
        </span>
      </div>
    </div>
  );
}

function ThreadPane({
  run = BERTH,
  nowMs,
  collapseWhenDone = false,
}: {
  run?: ProvisioningRun;
  nowMs: number;
  collapseWhenDone?: boolean;
}) {
  const done = nowMs >= Math.max(...run.steps.map((step) => step.endMs));
  return (
    <div
      data-shot="screen"
      className="flex flex-col bg-background"
      style={{ width: 1100, height: 720 }}
    >
      <div className="flex h-12 shrink-0 items-center border-b border-border-hairline px-4 text-sm text-muted-foreground">
        Investigate slow dashboard filters
      </div>
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col px-6 pt-6">
        <ThreadTimelineRows {...baseTimelineProps} timelineRows={[userRow]} />
        <div className="mt-4">
          <ProvisioningRow
            run={run}
            nowMs={nowMs}
            expanded={!(collapseWhenDone && done)}
          />
        </div>
        <div className="mt-auto pb-5">
          <Composer
            placeholder={
              done && collapseWhenDone
                ? "Ask for a follow-up"
                : composerPlaceholder(run, nowMs)
            }
          />
        </div>
      </div>
    </div>
  );
}

export function Thread() {
  return <ThreadPane nowMs={19_400} />;
}

function SheetRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="pt-1 text-xs text-subtle-foreground">{label}</span>
      <div>{children}</div>
    </>
  );
}

export function States() {
  return (
    <div
      data-shot="screen"
      className="bg-background p-10"
      style={{ width: 900 }}
    >
      <div className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-x-6 gap-y-5">
        <SheetRow label="Today, running">
          <ThreadTimelineRows
            {...baseTimelineProps}
            timelineRows={[legacyRow("pending")]}
          />
        </SheetRow>
        <SheetRow label="Today, done">
          <ThreadTimelineRows
            {...baseTimelineProps}
            timelineRows={[legacyRow("completed")]}
          />
        </SheetRow>
        <div className="col-span-2 border-t border-border-hairline" />
        <SheetRow label="Running">
          <ProvisioningRow run={BERTH} nowMs={19_400} expanded={false} />
        </SheetRow>
        <SheetRow label="Slow">
          <ProvisioningRow run={BERTH_SLOW} nowMs={72_000} expanded={false} />
        </SheetRow>
        <SheetRow label="Done">
          <ProvisioningRow run={BERTH} nowMs={60_000} expanded={false} />
        </SheetRow>
        <SheetRow label="Done, opened">
          <ProvisioningRow run={BERTH} nowMs={60_000} expanded />
        </SheetRow>
        <SheetRow label="Failed">
          <ProvisioningRow run={BERTH_FAILED} nowMs={60_000} expanded />
        </SheetRow>
      </div>
    </div>
  );
}

export function Live() {
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const startedAt = performance.now();
    const id = window.setInterval(() => {
      setNowMs((performance.now() - startedAt) % 40_000);
    }, 250);
    return () => window.clearInterval(id);
  }, []);
  return <ThreadPane nowMs={nowMs} />;
}

function readFrameHash(): { nowMs: number; slow: boolean } {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return {
    nowMs: Number(params.get("t") ?? "0"),
    slow: params.get("run") === "slow",
  };
}

export function Frame() {
  const [frame, setFrame] = useState(readFrameHash);
  useEffect(() => {
    const onHashChange = () => setFrame(readFrameHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return (
    <ThreadPane
      run={frame.slow ? BERTH_SLOW : BERTH}
      nowMs={frame.nowMs}
      collapseWhenDone
    />
  );
}
