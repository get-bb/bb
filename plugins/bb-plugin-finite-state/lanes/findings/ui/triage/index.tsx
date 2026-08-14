import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { useRpc } from "@bb/plugin-sdk/app";
import type { z } from "zod";
import type { VexStatus } from "../../../../lib/remote/types.js";
import type { findingsUiRpcContract } from "../../rpc.js";
import type { FindingRow } from "../columns.js";
import type { FindingSelection, SavedFindingView } from "../route.js";
import { BulkDecisionBar, type BulkFailure } from "./BulkDecisionBar.js";
import { TriageEditor, type TriageWriteError } from "./TriageEditor.js";
import { ShortcutSheet } from "./ShortcutSheet.js";
import { useFindingsShortcuts, type TriageShortcut } from "./keyboard.js";
import { SessionUndoStack, type UndoToken } from "./undo.js";
import { type TriageDraft, validateTriageDraft } from "./validation.js";

type TriageTarget = z.output<
  (typeof findingsUiRpcContract)["triageTargetsRead"]["output"]
>["items"][number];
type WriteResult = z.output<
  (typeof findingsUiRpcContract)["triageDecisionsWrite"]["output"]
>["results"][number];
type RpcUndoToken = z.output<
  (typeof findingsUiRpcContract)["triageDecisionUndo"]["input"]
>["token"];

interface TriageScope {
  workspaceProjectId: string;
  platformProjectId: string;
  projectVersionId: string;
}

interface ScopedTriageTarget {
  scope: TriageScope;
  target: TriageTarget;
}

interface UndoEntry {
  scope: TriageScope;
  target: TriageTarget;
  token: UndoToken;
  rpcToken: RpcUndoToken;
}

const WRITE_CHUNK = 20;
const TARGET_PAGE = 25;
const UNRESOLVED_DRAFT_SCOPE =
  "This draft has no resolved project and version scope. Choose an accepted findings version to continue.";

function selectedCount(selection: FindingSelection): number {
  return selection.mode === "explicit"
    ? selection.keys.size
    : Math.max(0, selection.total - selection.excluded.size);
}

function rowElement(
  rows: readonly FindingRow[],
  findingId: string | null,
): HTMLElement | null {
  if (!findingId) return null;
  const index = rows.findIndex((row) => row.findingId === findingId);
  const element =
    index < 0
      ? null
      : document.querySelector(`[data-finding-row][data-index="${index}"]`);
  return element instanceof HTMLElement ? element : null;
}

function currentRow(
  rows: readonly FindingRow[],
  cursorKey: string | null,
): FindingRow | null {
  return rows.find((row) => row.findingId === cursorKey) ?? rows[0] ?? null;
}

function draftFor(
  target: TriageTarget,
  status: VexStatus,
  includeSeed: boolean,
): TriageDraft {
  const prior = includeSeed ? target.prior : null;
  return {
    stableKey: target.stableKey,
    status,
    justification:
      status === "NOT_AFFECTED" ? (prior?.justification ?? null) : null,
    response: prior?.response ?? null,
    reason: prior?.reason ?? (includeSeed ? target.reasonSeed : ""),
    evidence: prior?.provenance.evidence ?? target.evidence,
    pin: prior?.pin ?? "exact_version",
  };
}

function conflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    /OVERLAY_CAS_CONFLICT|changed concurrently|newer YAML/iu.test(error.message)
  );
}

export function FindingsTriage({
  active,
  loading,
  workspaceProjectId,
  platformProjectId,
  projectVersionId,
  rows,
  total,
  filter,
  selection,
  cursorKey,
  onCursor,
  onOpen,
  onSelection,
  onCommitted,
}: {
  active: boolean;
  loading: boolean;
  workspaceProjectId: string | null;
  platformProjectId: string | null;
  projectVersionId: string | null;
  rows: readonly FindingRow[];
  total: number;
  filter: SavedFindingView["filter"];
  selection: FindingSelection;
  cursorKey: string | null;
  onCursor(findingId: string): void;
  onOpen(stableKey: string): void;
  onSelection(
    stableKey: string,
    selected: boolean,
    shift: boolean,
    anchorKey: string | null,
  ): void;
  onCommitted(): void;
}): React.JSX.Element {
  const rpc = useRpc<typeof findingsUiRpcContract>();
  const [sheet, setSheet] = useState(false);
  const [target, setTarget] = useState<TriageTarget | null>(null);
  const [singleScope, setSingleScope] = useState<TriageScope | null>(null);
  const [draft, setDraft] = useState<TriageDraft | null>(null);
  const [reasonConfirmed, setReasonConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState<TriageWriteError | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(
    "Findings shortcuts ready. Press question mark for the keyboard map.",
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkFailures, setBulkFailures] = useState<BulkFailure[]>([]);
  const [bulkOutcome, setBulkOutcome] = useState<string | null>(null);
  const [failedTargets, setFailedTargets] = useState<TriageTarget[]>([]);
  const [preparedBulk, setPreparedBulk] = useState<{
    selection: FindingSelection;
    targets: TriageTarget[];
  } | null>(null);
  const undoStack = useRef(new SessionUndoStack());
  const undoEntries = useRef(new Map<UndoToken, UndoEntry>());
  const bulkWriteInFlight = useRef(false);
  const anchorFindingId = useRef<string | null>(null);
  const count = selectedCount(selection);
  const scopeReady = Boolean(
    workspaceProjectId && platformProjectId && projectVersionId,
  );

  const exactSelectedIds = useMemo(() => {
    if (selection.mode !== "explicit") return [];
    const chosen = new Map<string, FindingRow>();
    for (const row of rows) {
      if (!selection.keys.has(row.stableKey)) continue;
      const current = chosen.get(row.stableKey);
      if (!current || row.findingId === cursorKey)
        chosen.set(row.stableKey, row);
    }
    return [...chosen.values()].map((row) => row.findingId);
  }, [cursorKey, rows, selection]);

  const sharedCollisionRows = useMemo(() => {
    if (selection.mode !== "explicit") return 0;
    const selectedRows = rows.filter((row) =>
      selection.keys.has(row.stableKey),
    ).length;
    return Math.max(0, selectedRows - exactSelectedIds.length);
  }, [exactSelectedIds.length, rows, selection]);

  const readExactTarget = useCallback(
    async (row: FindingRow): Promise<ScopedTriageTarget> => {
      if (!workspaceProjectId || !platformProjectId || !projectVersionId)
        throw new Error("Choose a findings scope before triage.");
      const scope = {
        workspaceProjectId,
        platformProjectId,
        projectVersionId,
      };
      const result = await rpc.call("triageTargetsRead", {
        ...scope,
        selection: { mode: "exact", findingIds: [row.findingId] },
        continuation: null,
      });
      const exact = result.items[0];
      if (!exact || exact.findingId !== row.findingId)
        throw new Error(
          "The exact selected finding row is no longer available.",
        );
      return { scope, target: exact };
    },
    [platformProjectId, projectVersionId, rpc, workspaceProjectId],
  );

  const beginSingle = useCallback(
    async (status: VexStatus) => {
      const row = currentRow(rows, cursorKey);
      if (!row) {
        setAnnouncement("Choose a finding before setting a status.");
        return;
      }
      setPending(true);
      setWriteError(null);
      try {
        const { scope, target: exact } = await readExactTarget(row);
        setTarget(exact);
        setSingleScope(scope);
        setDraft(draftFor(exact, status, true));
        setReasonConfirmed(false);
        setAnnouncement(
          `${status.replaceAll("_", " ")} draft opened for ${exact.label}. Review the seeded text before commit.`,
        );
      } catch (error) {
        setWriteError({
          kind: "write",
          message:
            error instanceof Error
              ? error.message
              : "Triage target could not be loaded.",
          file: null,
        });
      } finally {
        setPending(false);
      }
    },
    [cursorKey, readExactTarget, rows],
  );

  const advance = useCallback(
    (fromFindingId: string) => {
      const index = rows.findIndex((row) => row.findingId === fromFindingId);
      const next = rows[index + 1] ?? rows[index];
      if (!next) return;
      onCursor(next.findingId);
      window.requestAnimationFrame(() =>
        rowElement(rows, next.findingId)?.focus(),
      );
    },
    [onCursor, rows],
  );

  const rememberUndo = useCallback(
    (
      write: Extract<WriteResult, { success: true }>,
      exact: TriageTarget,
      scope: TriageScope,
    ) => {
      const token: UndoToken = write.undo;
      undoStack.current.push(token);
      undoEntries.current.set(token, {
        scope,
        token,
        rpcToken: write.undo,
        target: exact,
      });
    },
    [],
  );

  const commitSingle = useCallback(
    async (
      currentDraft: TriageDraft,
      currentTarget: TriageTarget,
      scope: TriageScope,
    ) => {
      setPending(true);
      setWriteError(null);
      try {
        const response = await rpc.call("triageDecisionsWrite", {
          ...scope,
          decisions: [
            {
              findingId: currentTarget.findingId,
              stableKey: currentTarget.stableKey,
              status: currentDraft.status,
              justification: currentDraft.justification,
              response: currentDraft.response,
              reason: currentDraft.reason.trim(),
              evidence: currentDraft.evidence.trim(),
              pin: currentDraft.pin,
              expectedSha256: currentTarget.expectedSha256,
            },
          ],
        });
        const result = response.results[0];
        if (!result || !result.success) {
          const failure = result && !result.success ? result : null;
          setWriteError({
            kind:
              failure?.code === "OVERLAY_CAS_CONFLICT" ? "conflict" : "write",
            message: failure?.message ?? "The local writer returned no result.",
            file: currentTarget.file,
          });
          return;
        }
        rememberUndo(result, currentTarget, scope);
        setAnnouncement(
          `${currentDraft.status.replaceAll("_", " ")} written locally for ${currentTarget.label}. Cursor advanced.`,
        );
        setDraft(null);
        setTarget(null);
        setSingleScope(null);
        setReasonConfirmed(false);
        onCommitted();
        advance(currentTarget.findingId);
      } catch (error) {
        setWriteError({
          kind: conflict(error) ? "conflict" : "write",
          message:
            error instanceof Error ? error.message : "The local write failed.",
          file: currentTarget.file,
        });
      } finally {
        setPending(false);
      }
    },
    [advance, onCommitted, rememberUndo, rpc],
  );

  const reloadTarget = useCallback(async () => {
    const row = target
      ? rows.find((candidate) => candidate.findingId === target.findingId)
      : null;
    if (!row) return;
    setPending(true);
    try {
      const { scope, target: reloaded } = await readExactTarget(row);
      setTarget(reloaded);
      setSingleScope(scope);
      setWriteError(null);
      setAnnouncement(
        `Reloaded CAS base for ${reloaded.label}; your draft was preserved.`,
      );
    } catch (error) {
      setWriteError({
        kind: "write",
        message:
          error instanceof Error
            ? error.message
            : "The CAS base could not be reloaded.",
        file: target?.file ?? null,
      });
    } finally {
      setPending(false);
    }
  }, [readExactTarget, rows, target]);

  useEffect(() => {
    if (!draft || !target || singleScope || !scopeReady) return;
    const row = rows.find(
      (candidate) => candidate.findingId === target.findingId,
    );
    if (!row) return;
    let cancelled = false;
    void readExactTarget(row)
      .then(({ scope, target: recovered }) => {
        if (cancelled) return;
        setTarget(recovered);
        setSingleScope(scope);
        setWriteError(null);
        setAnnouncement(
          `Recovered the project and version scope for ${recovered.label}; your draft was preserved.`,
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error
            ? error.message
            : "The draft scope could not be recovered.";
        setWriteError({ kind: "write", message, file: target.file });
        setAnnouncement(`Draft scope recovery failed: ${message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [draft, readExactTarget, rows, scopeReady, singleScope, target]);

  const undo = useCallback(async () => {
    const token = undoStack.current.peek();
    const entry = token ? undoEntries.current.get(token) : null;
    if (!token) {
      setUndoError(null);
      setAnnouncement("There is no local decision to undo in this session.");
      return;
    }
    if (!entry) {
      const message =
        "The last local decision has no saved undo scope. Its YAML was not changed.";
      setUndoError(message);
      setAnnouncement(`Undo was not attempted: ${message}`);
      return;
    }
    setPending(true);
    setUndoError(null);
    try {
      await rpc.call("triageDecisionUndo", {
        ...entry.scope,
        findingId: entry.target.findingId,
        stableKey: entry.target.stableKey,
        token: entry.rpcToken,
      });
      undoStack.current.accept(token);
      undoEntries.current.delete(token);
      setAnnouncement(
        `Undid the last local decision for ${entry.target.label}.`,
      );
      setUndoError(null);
      onCommitted();
    } catch (error) {
      const message = `Undo refused: ${error instanceof Error ? error.message : "the file changed after the decision"}. The newer YAML was preserved.`;
      setUndoError(message);
      setAnnouncement(message);
    } finally {
      setPending(false);
    }
  }, [onCommitted, rpc]);

  const move = useCallback(
    (delta: -1 | 1) => {
      if (rows.length === 0) return;
      const index = Math.max(
        0,
        rows.findIndex((row) => row.findingId === cursorKey),
      );
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + delta))];
      if (!next) return;
      onCursor(next.findingId);
      anchorFindingId.current = next.findingId;
      window.requestAnimationFrame(() =>
        rowElement(rows, next.findingId)?.focus(),
      );
    },
    [cursorKey, onCursor, rows],
  );

  const toggle = useCallback(
    (range: boolean) => {
      const row = currentRow(rows, cursorKey);
      if (!row) return;
      const isSelected =
        selection.mode === "explicit"
          ? selection.keys.has(row.stableKey)
          : !selection.excluded.has(row.stableKey);
      const anchor = anchorFindingId.current
        ? (rows.find(
            (candidate) => candidate.findingId === anchorFindingId.current,
          )?.stableKey ?? null)
        : null;
      onSelection(row.stableKey, !isSelected, range, anchor);
      if (!range) anchorFindingId.current = row.findingId;
    },
    [cursorKey, onSelection, rows, selection],
  );

  const loadBulkTargets = useCallback(async (): Promise<TriageTarget[]> => {
    if (!workspaceProjectId || !platformProjectId || !projectVersionId)
      throw new Error("Choose a findings scope before bulk triage.");
    if (selection.mode === "explicit") {
      const targets: TriageTarget[] = [];
      for (
        let index = 0;
        index < exactSelectedIds.length;
        index += TARGET_PAGE
      ) {
        const result = await rpc.call("triageTargetsRead", {
          workspaceProjectId,
          platformProjectId,
          projectVersionId,
          selection: {
            mode: "exact",
            findingIds: exactSelectedIds.slice(index, index + TARGET_PAGE),
          },
          continuation: null,
        });
        targets.push(...result.items);
      }
      return targets;
    }
    const targets: TriageTarget[] = [];
    let continuation: string | null = null;
    do {
      const result: {
        items: TriageTarget[];
        total: number;
        next: string | null;
      } = await rpc.call("triageTargetsRead", {
        workspaceProjectId,
        platformProjectId,
        projectVersionId,
        selection: {
          mode: "predicate",
          filters: selection.filter,
          excludedStableKeys: [...selection.excluded],
          total: selection.total,
        },
        continuation,
      });
      targets.push(...result.items);
      continuation = result.next;
    } while (continuation !== null);
    const unique = new Map<string, TriageTarget>();
    for (const exact of targets)
      if (!unique.has(exact.stableKey)) unique.set(exact.stableKey, exact);
    return [...unique.values()];
  }, [
    exactSelectedIds,
    platformProjectId,
    projectVersionId,
    rpc,
    selection,
    workspaceProjectId,
  ]);

  const prepareBulk = useCallback(
    async (status: VexStatus) => {
      const row = currentRow(rows, cursorKey);
      if (!row) {
        setAnnouncement("Choose a finding before setting a bulk status.");
        return;
      }
      setBulkOpen(true);
      setBulkConfirming(false);
      setPending(true);
      setBulkFailures([]);
      setBulkOutcome(null);
      try {
        const [scoped, targets] = await Promise.all([
          readExactTarget(row),
          loadBulkTargets(),
        ]);
        const exact = scoped.target;
        setPreparedBulk({ selection, targets });
        setTarget(exact);
        setSingleScope(scoped.scope);
        setDraft(draftFor(exact, status, false));
        setReasonConfirmed(false);
        setAnnouncement(
          `Bulk preview ready: ${targets.length} shared local overlay ${targets.length === 1 ? "identity" : "identities"} will be written.`,
        );
      } catch (error) {
        setBulkFailures([
          {
            findingId: "selection",
            stableKey: "selection",
            message:
              error instanceof Error
                ? error.message
                : "Bulk target loading failed.",
            retryable: false,
          },
        ]);
      } finally {
        setPending(false);
      }
    },
    [cursorKey, loadBulkTargets, readExactTarget, rows, selection],
  );

  const shortcut = useCallback(
    (command: TriageShortcut) => {
      if (command.action === "move") move(command.delta);
      else if (command.action === "open") {
        const row = currentRow(rows, cursorKey);
        if (row) onOpen(row.stableKey);
      } else if (command.action === "filter") {
        const input = document.querySelector('[aria-label="Filter component"]');
        if (input instanceof HTMLElement) input.focus();
      } else if (command.action === "toggle") toggle(false);
      else if (command.action === "range") toggle(true);
      else if (command.action === "bulk") setBulkOpen(true);
      else if (command.action === "undo") void undo();
      else if (command.action === "sheet") setSheet(true);
      else if (command.action === "status") {
        if (count > 0) void prepareBulk(command.status);
        else void beginSingle(command.status);
      }
    },
    [
      beginSingle,
      count,
      cursorKey,
      move,
      onOpen,
      prepareBulk,
      rows,
      toggle,
      undo,
    ],
  );

  useFindingsShortcuts(active, shortcut);

  const refreshTargets = useCallback(
    async (
      targets: readonly TriageTarget[],
    ): Promise<{
      targets: TriageTarget[];
      failures: BulkFailure[];
      retryTargets: TriageTarget[];
    }> => {
      if (!workspaceProjectId || !platformProjectId || !projectVersionId)
        throw new Error("Choose a findings scope before bulk triage.");
      const refreshed: TriageTarget[] = [];
      const failures: BulkFailure[] = [];
      const retryTargets: TriageTarget[] = [];
      for (let index = 0; index < targets.length; index += TARGET_PAGE) {
        const requested = targets.slice(index, index + TARGET_PAGE);
        try {
          const result = await rpc.call("triageTargetsRead", {
            workspaceProjectId,
            platformProjectId,
            projectVersionId,
            selection: {
              mode: "exact",
              findingIds: requested.map((exact) => exact.findingId),
            },
            continuation: null,
          });
          const byId = new Map(
            result.items.map((exact) => [exact.findingId, exact]),
          );
          for (const original of requested) {
            const exact = byId.get(original.findingId);
            if (exact) refreshed.push(exact);
            else {
              failures.push({
                findingId: original.findingId,
                stableKey: original.stableKey,
                message: `The exact selected finding row ${original.findingId} is no longer available.`,
                retryable: true,
              });
              retryTargets.push(original);
            }
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "The exact selected finding rows could not be refreshed.";
          for (const original of requested) {
            failures.push({
              findingId: original.findingId,
              stableKey: original.stableKey,
              message,
              retryable: true,
            });
            retryTargets.push(original);
          }
        }
      }
      return { targets: refreshed, failures, retryTargets };
    },
    [platformProjectId, projectVersionId, rpc, workspaceProjectId],
  );

  const writeBulkTargets = useCallback(
    async (
      targets: readonly TriageTarget[],
      preservedFailures: readonly BulkFailure[] = [],
    ) => {
      if (!draft) throw new Error("Bulk triage draft is no longer available.");
      if (!workspaceProjectId || !platformProjectId || !projectVersionId)
        throw new Error("Choose a findings scope before bulk triage.");
      const scope = {
        workspaceProjectId,
        platformProjectId,
        projectVersionId,
      };
      const failures: BulkFailure[] = [...preservedFailures];
      const retryTargets: TriageTarget[] = [];
      let successes = 0;
      for (let index = 0; index < targets.length; index += WRITE_CHUNK) {
        const requested = targets.slice(index, index + WRITE_CHUNK);
        const refreshed = await refreshTargets(requested);
        failures.push(...refreshed.failures);
        retryTargets.push(...refreshed.retryTargets);
        if (refreshed.targets.length > 0) {
          try {
            const response = await rpc.call("triageDecisionsWrite", {
              ...scope,
              decisions: refreshed.targets.map((exact) => ({
                findingId: exact.findingId,
                stableKey: exact.stableKey,
                status: draft.status,
                justification: draft.justification,
                response: draft.response,
                reason: draft.reason
                  .trim()
                  .replaceAll("{evidence}", exact.evidence),
                evidence: draft.evidence
                  .trim()
                  .replaceAll("{evidence}", exact.evidence),
                pin: draft.pin,
                expectedSha256: exact.expectedSha256,
              })),
            });
            refreshed.targets.forEach((exact, resultIndex) => {
              const result = response.results[resultIndex];
              if (!result) {
                failures.push({
                  findingId: exact.findingId,
                  stableKey: exact.stableKey,
                  message:
                    "The local writer returned no result for this finding.",
                  retryable: true,
                });
                retryTargets.push(exact);
              } else if (result.success) {
                successes += 1;
                rememberUndo(result, exact, scope);
              } else {
                failures.push({
                  findingId: result.findingId,
                  stableKey: result.stableKey,
                  message: result.message,
                  retryable: result.retryable,
                });
                if (result.retryable) retryTargets.push(exact);
              }
            });
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "The local writer failed before returning per-finding results.";
            for (const exact of refreshed.targets) {
              failures.push({
                findingId: exact.findingId,
                stableKey: exact.stableKey,
                message,
                retryable: true,
              });
              retryTargets.push(exact);
            }
          }
        }
        setAnnouncement(
          `Bulk local write progress: ${Math.min(index + requested.length, targets.length)} of ${targets.length} attempted.`,
        );
      }
      setBulkFailures(failures);
      setFailedTargets(retryTargets);
      const outcome = `Bulk local writes finished: ${successes} succeeded, ${failures.length} failed. Successful YAML changes were preserved.`;
      setAnnouncement(outcome);
      setBulkOutcome(
        `${successes} local YAML ${successes === 1 ? "decision" : "decisions"} written; ${failures.length} failed.`,
      );
      if (successes > 0) onCommitted();
      return { successes, failures: failures.length };
    },
    [
      draft,
      onCommitted,
      platformProjectId,
      projectVersionId,
      refreshTargets,
      rememberUndo,
      rpc,
      workspaceProjectId,
    ],
  );

  const previewTargets =
    preparedBulk?.selection === selection ? preparedBulk.targets : null;
  const previewCount = previewTargets?.length ?? count;
  const previewSharedRows = Math.max(
    sharedCollisionRows,
    previewTargets ? count - previewTargets.length : 0,
  );
  const previewExisting =
    previewTargets?.filter((exact) => exact.prior !== null).length ?? 0;

  const confirmBulk = useCallback(
    async (retry = false) => {
      if (pending || bulkWriteInFlight.current) {
        setAnnouncement("A bulk local write is already in progress.");
        return;
      }
      if (!draft || !reasonConfirmed || !validateTriageDraft(draft).ok) {
        setBulkOutcome(
          "Bulk local writes were not started. Review the draft and confirm its reason and evidence.",
        );
        return;
      }
      bulkWriteInFlight.current = true;
      setPending(true);
      setBulkOutcome(null);
      try {
        const result = await writeBulkTargets(
          retry
            ? failedTargets
            : preparedBulk?.selection === selection
              ? preparedBulk.targets
              : await loadBulkTargets(),
          retry ? bulkFailures.filter((failure) => !failure.retryable) : [],
        );
        setBulkConfirming(false);
        if (result.failures === 0) {
          setDraft(null);
          setTarget(null);
          setPreparedBulk(null);
          setReasonConfirmed(false);
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Bulk target loading failed.";
        setBulkFailures([
          {
            findingId: "selection",
            stableKey: "selection",
            message,
            retryable: false,
          },
        ]);
        setBulkOutcome(`Bulk local writes failed: ${message}`);
      } finally {
        bulkWriteInFlight.current = false;
        setPending(false);
      }
    },
    [
      bulkFailures,
      draft,
      failedTargets,
      loadBulkTargets,
      pending,
      preparedBulk,
      reasonConfirmed,
      selection,
      writeBulkTargets,
    ],
  );

  const requestBulkConfirmation = useCallback(() => {
    if (!draft || !reasonConfirmed || !validateTriageDraft(draft).ok) {
      setBulkOutcome(
        "Bulk local writes were not started. Review the draft and confirm its reason and evidence.",
      );
      return;
    }
    setBulkOutcome(null);
    setBulkConfirming(true);
    setAnnouncement(
      `Bulk confirmation ready: review the ${previewCount.toLocaleString()}-decision blast radius, then confirm local writes.`,
    );
  }, [draft, previewCount, reasonConfirmed]);

  const readiness = pending
    ? "Local triage write or target load in progress…"
    : !scopeReady
      ? "Choose a project and accepted findings version to enable local triage."
      : loading && rows.length === 0
        ? "Loading exact finding identities for local triage…"
        : rows.length === 0
          ? `No finding is available in this ${total > 0 ? "loaded page" : "scope"}. Local drafts are unchanged.`
          : "Local triage ready · YAML only · no push";

  return (
    <>
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
      <div
        aria-description="Findings shortcuts: j and k navigate, Enter opens detail, slash focuses filters, x toggles selection, Shift-X selects a range, b opens bulk actions, u undoes, question mark opens help, and n/e/t/f/r/Shift-R choose VEX status."
        aria-keyshortcuts="j k Enter / x Shift+X b u Shift+/ n e t f r Shift+R"
        className="flex items-center justify-between border-y border-border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground"
      >
        <span>{readiness}</span>
        <Button
          aria-description="Open the complete keyboard shortcut reference"
          onClick={() => setSheet(true)}
          size="sm"
          variant="ghost"
        >
          <Icon aria-hidden="true" className="size-3.5" name="CircleQuestion" />
          Shortcuts <kbd className="font-mono">?</kbd>
        </Button>
      </div>
      {undoError ? (
        <div
          className="border-b border-destructive/40 bg-muted px-3 py-2 text-xs text-destructive"
          role="alert"
        >
          {undoError}
        </div>
      ) : null}
      {draft && target ? (
        <TriageEditor
          commitBlockedReason={
            count === 0 && !singleScope ? UNRESOLVED_DRAFT_SCOPE : null
          }
          draft={draft}
          error={writeError}
          onCancel={() => {
            setDraft(null);
            setTarget(null);
            setSingleScope(null);
            setWriteError(null);
          }}
          onChange={(next) => {
            setBulkConfirming(false);
            setBulkOutcome(null);
            setDraft(
              next.status === "NOT_AFFECTED"
                ? next
                : { ...next, justification: null },
            );
          }}
          onCommit={
            count > 0
              ? bulkConfirming
                ? () => {
                    void confirmBulk(false);
                  }
                : requestBulkConfirmation
              : singleScope
                ? () => {
                    void commitSingle(draft, target, singleScope);
                  }
                : () => {
                    setWriteError({
                      kind: "write",
                      message: UNRESOLVED_DRAFT_SCOPE,
                      file: target.file,
                    });
                    setAnnouncement(
                      `Local YAML was not written: ${UNRESOLVED_DRAFT_SCOPE}`,
                    );
                  }
          }
          onReasonConfirmed={(confirmed) => {
            setBulkConfirming(false);
            setBulkOutcome(null);
            setReasonConfirmed(confirmed);
          }}
          onReload={reloadTarget}
          pending={pending}
          prior={count > 0 ? null : target.prior}
          reasonConfirmed={reasonConfirmed}
          seededReason={
            !target.prior &&
            draft.reason === target.reasonSeed &&
            target.reasonSeed.length > 0
          }
          targetLabel={
            count > 0
              ? `${previewCount.toLocaleString()} local overlay ${previewCount === 1 ? "identity" : "identities"}`
              : target.label
          }
        />
      ) : null}
      <BulkDecisionBar
        confirming={bulkConfirming}
        count={previewCount}
        existingDecisionCount={previewExisting}
        failures={bulkFailures}
        onCancel={() => {
          setDraft(null);
          setTarget(null);
          setBulkConfirming(false);
          setBulkOpen(false);
          setBulkOutcome(null);
        }}
        onConfirm={() => void confirmBulk(false)}
        onOpen={() => setBulkOpen(true)}
        onRetry={() => void confirmBulk(true)}
        onStatus={(status) => void prepareBulk(status)}
        open={bulkOpen}
        outcome={bulkOutcome}
        pending={pending}
        predicate={selection.mode === "predicate"}
        sharedCollisionRows={previewSharedRows}
        status={draft?.status ?? null}
      />
      {sheet ? <ShortcutSheet onOpenChange={setSheet} open /> : null}
    </>
  );
}

export function FindingsTriageStub({
  kind,
}: {
  kind: "policy" | "import";
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center p-6">
      <div className="max-w-lg rounded-lg border border-border bg-card p-6 text-center">
        <Icon
          aria-hidden="true"
          className="mx-auto size-6 text-muted-foreground"
          name={kind === "policy" ? "SlidersHorizontal" : "Download"}
        />
        <h2 className="mt-3 text-base font-semibold">
          {kind === "policy" ? "Triage policy" : "Import findings"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This route is reserved for its owning work package. Manual decisions
          are available on the findings table and write local YAML only.
        </p>
      </div>
    </div>
  );
}
