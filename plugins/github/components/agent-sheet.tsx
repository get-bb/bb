import { useCallback, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreads,
  useBbNavigate,
  useRpc,
  useSdk,
  type NewThreadComposerProps,
  type NewThreadRequest,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  agentThreadTitle,
  issuePrompt,
  issueThreadTitle,
  presetPrompt,
  type BranchCheckout,
} from "../agent-presets.js";
import { middleTruncate } from "../app-logic.js";
import type { AgentPreset } from "../pull-status.js";
import type { githubRpcContract } from "../server.js";
import {
  errorText,
  useBranchEnvironment,
  useProjectHost,
  useReturnFocus,
  useStatus,
} from "./shared.js";

export type AgentTarget =
  | {
      kind: "pr";
      repo: string;
      number: number;
      title: string;
      headRefName: string;
      baseRefName: string;
      isCrossRepository: boolean;
      preset: AgentPreset;
    }
  | { kind: "issue"; repo: string; number: number; title: string };

interface Seed {
  ready: boolean;
  projectId: string | null;
  environment: NewThreadComposerProps["defaultEnvironment"];
  title: string;
  prompt: string;
  where: string;
}

function useSeed(target: AgentTarget): Seed {
  const status = useStatus();
  const sidebar = experimental_useSidebarThreads();
  const findEnvironment = useBranchEnvironment();
  const hostOf = useProjectHost();
  const ready = status !== null && sidebar.status !== "loading";
  const repoProjectId =
    status?.repos.find((entry) => entry.repo === target.repo)?.projectId ??
    null;
  const projectId = repoProjectId ?? status?.defaultProjectId ?? null;
  if (target.kind === "issue") {
    return {
      ready,
      projectId,
      environment: undefined,
      title: issueThreadTitle(target),
      prompt: issuePrompt(target),
      where: `#${target.number} · ${target.repo}`,
    };
  }
  const branch = middleTruncate(target.headRefName, 40);
  const reuse = target.isCrossRepository
    ? null
    : findEnvironment(target.headRefName, repoProjectId);
  const hostId = target.isCrossRepository ? null : hostOf(projectId);
  const [environment, checkout, where]: [
    Seed["environment"],
    BranchCheckout,
    string,
  ] =
    reuse !== null
      ? [
          { type: "reuse", environmentId: reuse },
          "same-branch",
          `the bb worktree on ${branch}`,
        ]
      : hostId !== null
        ? [
            {
              type: "host",
              hostId,
              workspace: {
                type: "managed-worktree",
                baseBranch: {
                  kind: "named",
                  name: `origin/${target.headRefName}`,
                },
              },
            },
            "new-branch",
            `a new worktree from ${branch}`,
          ]
        : [undefined, "checkout", `checks out ${branch} first`];
  const pull = { ...target, branchCheckout: checkout };
  return {
    ready,
    projectId,
    environment,
    title: agentThreadTitle(target.preset, pull),
    prompt: presetPrompt(target.preset, pull),
    where: `#${target.number} · ${where}`,
  };
}

export function AgentSheet({
  target,
  returnFocusTo,
  onOpenChange,
}: {
  target: AgentTarget | null;
  returnFocusTo?: () => HTMLElement | null;
  onOpenChange: (open: boolean) => void;
}) {
  const returnFocus = useReturnFocus(target !== null, returnFocusTo);
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" onCloseAutoFocus={returnFocus}>
        {target === null ? null : (
          <AgentSheetBody
            key={`${target.kind}:${target.repo}#${target.number}`}
            target={target}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AgentSheetBody({
  target,
  onDone,
}: {
  target: AgentTarget;
  onDone: () => void;
}) {
  const rpc = useRpc<typeof githubRpcContract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const seed = useSeed(target);
  const [starting, setStarting] = useState(false);
  const submit = useCallback(
    async (request: NewThreadRequest) => {
      setStarting(true);
      let threadId: string;
      try {
        threadId = (await sdk.threads.spawn({ ...request, title: seed.title }))
          .id;
      } catch (failure) {
        setStarting(false);
        toast.error(`Couldn't start an agent on #${target.number}`, {
          description: errorText(failure),
        });
        throw failure;
      }
      try {
        await rpc.call("linkThread", {
          kind: target.kind,
          repo: target.repo,
          number: target.number,
          threadId,
        });
        toast.success(`Agent started on #${target.number}`, {
          action: { label: "Open", onClick: () => navigate.toThread(threadId) },
        });
      } catch (failure) {
        toast.warning(`Agent started, but #${target.number} isn't linked`, {
          description: errorText(failure),
        });
      }
      setStarting(false);
      onDone();
    },
    [navigate, onDone, rpc, sdk, seed.title, target],
  );
  const draftKey = `github:${target.kind}:${target.repo}#${target.number}`;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Start an agent</DialogTitle>
        <DialogDescription
          aria-live="polite"
          className={`truncate ${starting ? "animate-shine" : ""}`}
        >
          {starting ? "Starting the agent…" : seed.where}
        </DialogDescription>
      </DialogHeader>
      {seed.ready ? (
        <NewThreadComposer
          key={draftKey}
          {...(seed.projectId === null
            ? {}
            : { defaultProjectId: seed.projectId })}
          {...(seed.environment === undefined
            ? {}
            : { defaultEnvironment: seed.environment })}
          initialPrompt={seed.prompt}
          draftKey={draftKey}
          layout="document"
          focusRequest={1}
          className="min-h-48"
          onSubmit={submit}
        />
      ) : (
        <div
          aria-hidden
          className="flex min-h-48 flex-col gap-2 rounded-xl border border-border p-4"
        >
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-2/5" />
          <div className="mt-auto flex justify-between">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="size-7 rounded-full" />
          </div>
        </div>
      )}
    </>
  );
}
