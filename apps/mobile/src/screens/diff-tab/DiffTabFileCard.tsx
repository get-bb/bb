import type { DiffFileEntry } from "@bb/server-contract";
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import {
  buildDiffAddToChatText,
  buildDiffPathAddToChatText,
  resolveDiffFileBodyState,
  useDiffCardCollapsed,
  type DiffFileBodyState,
  type DiffPatchState,
  type LoadDiffPatchPath,
} from "@/data/diff";
import { DiffFileCard, parseUnifiedDiff, type DiffFile } from "@/diff";
import { Skeleton, Text } from "@/ui";

interface DiffTabFileCardProps {
  entry: DiffFileEntry;
  /** The active (environment, target, merge-base sha) slice; scopes collapse state. */
  diffIdentity: string;
  fileCount: number;
  patchState: DiffPatchState;
  loadPath: LoadDiffPatchPath;
  retry: LoadDiffPatchPath;
  /** Quote this file's patch (or path) into the composer; hidden when absent. */
  onAddToChat?: (text: string) => void;
  workspaceRootPath?: string | null;
  testID?: string;
}

/**
 * A TOC entry as a `DiffFile` with no hunks: the header (path, rename arrow,
 * change kind, +/- tally) renders from the entry alone, so `on_demand` /
 * `too_large` / loading rows look like every other card.
 */
function entryToDiffFile(entry: DiffFileEntry): DiffFile {
  return {
    path: entry.path,
    previousPath: entry.previousPath,
    changeKind: entry.changeKind,
    binary: entry.binary,
    hunks: [],
    stats: { additions: entry.additions, deletions: entry.deletions },
  };
}

function arePatchStatesEqual(a: DiffPatchState, b: DiffPatchState): boolean {
  return (
    a.status === b.status &&
    a.patch === b.patch &&
    a.truncated === b.truncated &&
    a.error === b.error
  );
}

function Notice({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View
      className="flex-row flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5"
      testID={testID}
    >
      {children}
    </View>
  );
}

function LinkButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <Text className="text-xs text-primary underline">{label}</Text>
    </Pressable>
  );
}

function BodySkeleton() {
  return (
    <View className="gap-1.5 px-3 py-3" testID="diff-tab-file-skeleton">
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-[96%] rounded-sm" />
      <Skeleton className="h-3 w-[90%] rounded-sm" />
      <Skeleton className="h-3 w-[84%] rounded-sm" />
    </View>
  );
}

interface CardBodyProps {
  entry: DiffFileEntry;
  state: Exclude<DiffFileBodyState, { kind: "loaded" }>;
  onLoadPatch: () => void;
  onRetry: () => void;
}

function CardBody({ entry, state, onLoadPatch, onRetry }: CardBodyProps) {
  const changedLines = (entry.additions + entry.deletions).toLocaleString(
    "en-US",
  );
  switch (state.kind) {
    case "error":
      return (
        <Notice testID="diff-tab-file-error">
          <Text className="text-xs text-destructive-text">{state.message}</Text>
          <LinkButton
            label="Retry"
            onPress={onRetry}
            testID="diff-tab-file-retry"
          />
        </Notice>
      );
    case "too-large":
      return (
        <Notice testID="diff-tab-file-too-large">
          <Text variant="caption">
            Too large to display ({changedLines} changed lines).
          </Text>
        </Notice>
      );
    case "load-on-demand":
      return (
        <Notice testID="diff-tab-file-on-demand">
          <Text variant="caption">
            {entry.binary ? "Binary file." : `${changedLines} changed lines.`}
          </Text>
          <LinkButton
            label="Load diff"
            onPress={onLoadPatch}
            testID="diff-tab-file-load"
          />
        </Notice>
      );
    case "loading":
      return <BodySkeleton />;
  }
}

/**
 * The diff tab's per-file card: the shared `DiffFileCard` header from the
 * TOC entry, with a body gated by the entry's `loadMode` tier and the patch
 * state — the parsed hunks once the patch lands (`auto`, or `on_demand` after
 * "Load diff"), a skeleton while it loads, the "Load diff" / "too large"
 * notices, and a per-card Retry after an error. The last parsed patch stays on
 * screen while a realtime eviction reloads it, so a file edit does not flash
 * the card back to a skeleton.
 */
export const DiffTabFileCard = memo(
  function DiffTabFileCard({
    entry,
    diffIdentity,
    fileCount,
    patchState,
    loadPath,
    retry,
    onAddToChat,
    workspaceRootPath,
    testID,
  }: DiffTabFileCardProps) {
    const { collapsed, toggle } = useDiffCardCollapsed(
      diffIdentity,
      entry,
      fileCount,
    );
    const bodyState = resolveDiffFileBodyState(entry, patchState);
    // Keyed on the patch text (not the freshly built body state) so the
    // parse — and the retained-file state below — only move when it changes.
    const patchText = bodyState.kind === "loaded" ? bodyState.patch : null;
    const parsed = useMemo<DiffFile | null>(
      () =>
        patchText === null
          ? null
          : (parseUnifiedDiff(patchText).files[0] ?? null),
      [patchText],
    );
    // Retain the last parsed file across a reload of the same slice so a
    // realtime eviction does not flash the card back to a skeleton (the
    // React "information from previous renders" pattern: state set during
    // render when the parsed file changes).
    const retainKey = `${diffIdentity}\n${entry.path}`;
    const [lastParsed, setLastParsed] = useState<{
      key: string;
      file: DiffFile;
    } | null>(null);
    if (parsed !== null && lastParsed?.file !== parsed) {
      setLastParsed({ key: retainKey, file: parsed });
    }
    const retained =
      parsed ??
      (bodyState.kind === "loading" && lastParsed?.key === retainKey
        ? lastParsed.file
        : null);

    const onLoadPatch = useCallback(
      () => loadPath(entry.path),
      [entry.path, loadPath],
    );
    const onRetry = useCallback(() => retry(entry.path), [entry.path, retry]);
    const addToChat = useMemo(() => {
      if (!onAddToChat) return undefined;
      return (file: DiffFile) =>
        onAddToChat(
          file.hunks.length > 0 || file.binary
            ? buildDiffAddToChatText(file, { workspaceRootPath })
            : buildDiffPathAddToChatText(file.path, workspaceRootPath),
        );
    }, [onAddToChat, workspaceRootPath]);

    const file = retained ?? entryToDiffFile(entry);
    let body: ReactNode | undefined;
    if (retained === null) {
      body =
        bodyState.kind === "loaded" ? (
          <Notice testID="diff-tab-file-unrenderable">
            <Text variant="caption">No renderable diff for this file.</Text>
          </Notice>
        ) : (
          <CardBody
            entry={entry}
            state={bodyState}
            onLoadPatch={onLoadPatch}
            onRetry={onRetry}
          />
        );
    }
    const footer =
      bodyState.kind === "loaded" && bodyState.truncated ? (
        <View className="border-t border-border px-3 py-1.5">
          <Text variant="caption">
            Patch truncated: the server cut this file's diff at its size budget.
          </Text>
        </View>
      ) : undefined;

    return (
      <DiffFileCard
        file={file}
        collapsed={collapsed}
        onToggleCollapsed={toggle}
        body={body}
        footer={footer}
        showChangeKind
        onAddToChat={addToChat}
        testID={testID}
      />
    );
  },
  (previous, next) =>
    previous.entry === next.entry &&
    previous.diffIdentity === next.diffIdentity &&
    previous.fileCount === next.fileCount &&
    previous.loadPath === next.loadPath &&
    previous.retry === next.retry &&
    previous.onAddToChat === next.onAddToChat &&
    previous.workspaceRootPath === next.workspaceRootPath &&
    previous.testID === next.testID &&
    arePatchStatesEqual(previous.patchState, next.patchState),
);
