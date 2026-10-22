import { useCallback, useRef, useSyncExternalStore } from "react";
import { experimental_Icon as Icon, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS,
  COARSE_POINTER_PROMPT_COMBO_BUTTON_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { githubRpcContract } from "../server.js";
import {
  currentActivity,
  isInFlight,
  markSettled,
  setActivity,
} from "./pull-actions.js";
import {
  errorText,
  itemKey,
  readStored,
  useBranchEnvironment,
  useRepoSettings,
  useStatus,
  writeStored,
  type MergeMethod,
  type RepoSettings,
} from "./shared.js";

export interface MergeTarget {
  repo: string;
  number: number;
  baseRefName: string;
  headRefName: string;
  headRefOid: string | null;
  isCrossRepository: boolean;
  canDeleteBranch: boolean;
}

const MERGE_METHODS: ReadonlyArray<{ method: MergeMethod; label: string }> = [
  { method: "merge", label: "Merge" },
  { method: "squash", label: "Squash merge" },
  { method: "rebase", label: "Rebase and merge" },
];

const MERGED_AS: Record<MergeMethod, string> = {
  merge: "Merged",
  squash: "Squash-merged",
  rebase: "Rebased and merged",
};

const DELETE_BRANCH_KEY = "bb-plugin-github:v4:delete-branch";

export function useMerge(): (
  target: MergeTarget,
  method: MergeMethod,
  deleteBranch: boolean,
) => void {
  const rpc = useRpc<typeof githubRpcContract>();
  return useCallback(
    (target, method, deleteBranch) => {
      const key = itemKey(target);
      const current = currentActivity(key);
      if (isInFlight(current) || current?.kind === "merged") return;
      setActivity(key, { kind: "merging", base: target.baseRefName });
      rpc
        .call("mergePull", {
          repo: target.repo,
          number: target.number,
          method,
          deleteBranch,
          headRefOid: target.headRefOid,
        })
        .then(
          (result) => {
            markSettled(key, { kind: "merged", base: target.baseRefName });
            toast.success(
              `${MERGED_AS[result.method]} #${target.number} into ${target.baseRefName}${result.deletedBranch ? " · branch deleted" : ""}`,
              { id: `github-merge-${key}` },
            );
          },
          (error: unknown) => {
            setActivity(key, null);
            toast.error(`Couldn't merge #${target.number}`, {
              id: `github-merge-${key}`,
              description: errorText(error),
            });
          },
        );
    },
    [rpc],
  );
}

function useKeepsBranch(): (target: MergeTarget) => boolean {
  const status = useStatus();
  const findEnvironment = useBranchEnvironment();
  return useCallback(
    (target) => {
      if (target.isCrossRepository || status === null) return true;
      const projectId =
        status.repos.find((entry) => entry.repo === target.repo)?.projectId ??
        null;
      return findEnvironment(target.headRefName, projectId) !== null;
    },
    [findEnvironment, status],
  );
}

interface MergeOptions {
  methods: ReadonlyArray<{ method: MergeMethod; label: string }>;
  preferred: { method: MergeMethod; label: string } | null;
  offerDelete: boolean;
}

function useMergeOptions(
  target: MergeTarget,
  known: RepoSettings | null,
): MergeOptions | null {
  const stored = useRepoSettings()?.[target.repo] ?? null;
  const keepsBranch = useKeepsBranch();
  const settings = known ?? stored;
  if (settings === null) return null;
  const allowed = MERGE_METHODS.filter((entry) =>
    settings.mergeMethods.includes(entry.method),
  );
  const preferred =
    allowed.find((entry) => entry.method === settings.defaultMergeMethod) ??
    allowed[0] ??
    null;
  return {
    methods:
      preferred === null
        ? allowed
        : [preferred, ...allowed.filter((entry) => entry !== preferred)],
    preferred,
    offerDelete:
      target.canDeleteBranch &&
      !settings.deleteBranchOnMerge &&
      !keepsBranch(target),
  };
}

const deleteBranchListeners = new Set<() => void>();

function readDeleteBranch(): boolean {
  return readStored(DELETE_BRANCH_KEY) === "1";
}

function subscribeDeleteBranch(listener: () => void): () => void {
  deleteBranchListeners.add(listener);
  return () => deleteBranchListeners.delete(listener);
}

function useDeleteBranch(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribeDeleteBranch,
    readDeleteBranch,
    readDeleteBranch,
  );
  const update = useCallback((next: boolean) => {
    writeStored(DELETE_BRANCH_KEY, next ? "1" : "0");
    for (const listener of deleteBranchListeners) listener();
  }, []);
  return [value, update];
}

export function MergeMethodItems({
  target,
  known,
  onMerge,
}: {
  target: MergeTarget;
  known: RepoSettings | null;
  onMerge: (method: MergeMethod, deleteBranch: boolean) => void;
}) {
  const options = useMergeOptions(target, known);
  const [deleteBranch, setDeleteBranch] = useDeleteBranch();
  if (options === null) {
    return (
      <DropdownMenuItem inset disabled>
        Loading the merge methods…
      </DropdownMenuItem>
    );
  }
  return (
    <>
      <DropdownMenuLabel>
        Merge #{target.number} into{" "}
        <span className="font-mono break-all">{target.baseRefName}</span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {options.methods.map((entry) => (
        <DropdownMenuItem
          key={entry.method}
          inset
          onSelect={() =>
            onMerge(entry.method, options.offerDelete && deleteBranch)
          }
        >
          {entry.label}
        </DropdownMenuItem>
      ))}
      {options.offerDelete ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            className="pl-8"
            checked={deleteBranch}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => setDeleteBranch(checked === true)}
          >
            Delete the branch
          </DropdownMenuCheckboxItem>
        </>
      ) : null}
    </>
  );
}

export function MergeButton({
  target,
  known,
  primary,
  menuOpen,
  onMenuOpenChange,
}: {
  target: MergeTarget;
  known: RepoSettings;
  primary: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const merge = useMerge();
  const options = useMergeOptions(target, known);
  const [deleteBranch] = useDeleteBranch();
  const rootRef = useRef<HTMLDivElement>(null);
  const preferred = options?.preferred ?? null;
  if (options === null || preferred === null) return null;
  const variant = primary ? "default" : "outline";
  const start = (method: MergeMethod, remove: boolean) => {
    rootRef.current
      ?.closest<HTMLElement>("[data-next-step]")
      ?.focus({ preventScroll: true });
    merge(target, method, remove);
  };
  return (
    <div ref={rootRef} className="flex min-w-0 @max-[35rem]/github:w-full">
      <Button
        type="button"
        size="sm"
        variant={variant}
        aria-keyshortcuts="M"
        className={`${COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS} min-w-0 rounded-r-none @max-[35rem]/github:flex-1`}
        onClick={() =>
          start(preferred.method, options.offerDelete && deleteBranch)
        }
      >
        <Icon name="GitMerge" />
        {preferred.label}
      </Button>
      <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={variant}
            aria-label="Choose pull request merge method"
            className={`${COARSE_POINTER_PROMPT_COMBO_BUTTON_CLASS} ${primary ? "" : "border-l-0"}`}
          >
            <Icon name="ChevronDown" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-56"
          mobileTitle={`Merge pull request #${target.number}`}
        >
          <MergeMethodItems
            target={target}
            known={known}
            onMerge={(method, remove) => start(method, remove)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
