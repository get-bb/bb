import { useCallback, useMemo, useRef, useState } from "react";
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

type TriageTarget = z.output<(typeof findingsUiRpcContract)["triageTargetsRead"]["output"]>["items"][number];
type WriteResult = z.output<(typeof findingsUiRpcContract)["triageDecisionsWrite"]["output"]>["results"][number];
type RpcUndoToken = z.output<(typeof findingsUiRpcContract)["triageDecisionUndo"]["input"]>["token"];

interface UndoEntry {
  target: TriageTarget;
  token: UndoToken;
  rpcToken: RpcUndoToken;
}

const WRITE_CHUNK = 20;
const TARGET_PAGE = 25;

function selectedCount(selection: FindingSelection): number {
  return selection.mode === "explicit" ? selection.keys.size : Math.max(0, selection.total - selection.excluded.size);
}

function rowElement(rows: readonly FindingRow[], findingId: string | null): HTMLElement | null {
  if (!findingId) return null;
  const index = rows.findIndex(row => row.findingId === findingId);
  const element = index < 0 ? null : document.querySelector(`[data-finding-row][data-index="${index}"]`);
  return element instanceof HTMLElement ? element : null;
}

function currentRow(rows: readonly FindingRow[], cursorKey: string | null): FindingRow | null {
  return rows.find(row => row.findingId === cursorKey) ?? rows[0] ?? null;
}

function draftFor(target: TriageTarget, status: VexStatus, includeSeed: boolean): TriageDraft {
  return {
    stableKey: target.stableKey,
    status,
    justification: null,
    response: null,
    reason: includeSeed ? target.reasonSeed : "",
    evidence: target.evidence,
    pin: "exact_version",
  };
}

function conflict(error: unknown): boolean {
  return error instanceof Error && /OVERLAY_CAS_CONFLICT|changed concurrently|newer YAML/iu.test(error.message);
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
  onSelection(stableKey: string, selected: boolean, shift: boolean, anchorKey: string | null): void;
  onCommitted(): void;
}): React.JSX.Element {
  const rpc = useRpc<typeof findingsUiRpcContract>();
  const [sheet, setSheet] = useState(false);
  const [target, setTarget] = useState<TriageTarget | null>(null);
  const [draft, setDraft] = useState<TriageDraft | null>(null);
  const [reasonConfirmed, setReasonConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [writeError, setWriteError] = useState<TriageWriteError | null>(null);
  const [announcement, setAnnouncement] = useState("Findings shortcuts ready. Press question mark for the keyboard map.");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkFailures, setBulkFailures] = useState<BulkFailure[]>([]);
  const [failedTargets, setFailedTargets] = useState<TriageTarget[]>([]);
  const undoStack = useRef(new SessionUndoStack());
  const undoEntries = useRef(new Map<UndoToken, UndoEntry>());
  const anchorFindingId = useRef<string | null>(null);
  const count = selectedCount(selection);
  const scopeReady = Boolean(workspaceProjectId && platformProjectId && projectVersionId);

  const exactSelectedIds = useMemo(() => {
    if (selection.mode !== "explicit") return [];
    return rows.filter(row => selection.keys.has(row.stableKey)).map(row => row.findingId);
  }, [rows, selection]);

  const readExactTarget = useCallback(async (row: FindingRow): Promise<TriageTarget> => {
    if (!workspaceProjectId || !platformProjectId || !projectVersionId) throw new Error("Choose a findings scope before triage.");
    const result = await rpc.call("triageTargetsRead", {
      workspaceProjectId,
      platformProjectId,
      projectVersionId,
      selection: { mode: "exact", findingIds: [row.findingId] },
      continuation: null,
    });
    const exact = result.items[0];
    if (!exact || exact.findingId !== row.findingId) throw new Error("The exact selected finding row is no longer available.");
    return exact;
  }, [platformProjectId, projectVersionId, rpc, workspaceProjectId]);

  const beginSingle = useCallback(async (status: VexStatus) => {
    const row = currentRow(rows, cursorKey);
    if (!row) { setAnnouncement("Choose a finding before setting a status."); return; }
    setPending(true);
    setWriteError(null);
    try {
      const exact = await readExactTarget(row);
      setTarget(exact);
      setDraft(draftFor(exact, status, true));
      setReasonConfirmed(false);
      setAnnouncement(`${status.replaceAll("_", " ")} draft opened for ${exact.label}. Review the seeded text before commit.`);
    } catch (error) {
      setWriteError({ kind: "write", message: error instanceof Error ? error.message : "Triage target could not be loaded.", file: null });
    } finally { setPending(false); }
  }, [cursorKey, readExactTarget, rows]);

  const advance = useCallback((fromFindingId: string) => {
    const index = rows.findIndex(row => row.findingId === fromFindingId);
    const next = rows[index + 1] ?? rows[index];
    if (!next) return;
    onCursor(next.findingId);
    window.requestAnimationFrame(() => rowElement(rows, next.findingId)?.focus());
  }, [onCursor, rows]);

  const rememberUndo = useCallback((write: Extract<WriteResult, { success: true }>, exact: TriageTarget) => {
    const token: UndoToken = write.undo;
    undoStack.current.push(token);
    undoEntries.current.set(token, { token, rpcToken: write.undo, target: exact });
  }, []);

  const commitSingle = useCallback(async () => {
    if (!draft || !target || !workspaceProjectId || !platformProjectId || !projectVersionId) return;
    const validation = validateTriageDraft(draft);
    if (!validation.ok || !reasonConfirmed) return;
    setPending(true);
    setWriteError(null);
    try {
      const response = await rpc.call("triageDecisionsWrite", {
        workspaceProjectId,
        platformProjectId,
        projectVersionId,
        decisions: [{
          findingId: target.findingId,
          stableKey: target.stableKey,
          status: draft.status,
          justification: draft.justification,
          response: draft.response,
          reason: draft.reason.trim(),
          evidence: draft.evidence.trim(),
          pin: draft.pin,
          expectedSha256: target.expectedSha256,
        }],
      });
      const result = response.results[0];
      if (!result || !result.success) {
        const failure = result && !result.success ? result : null;
        setWriteError({ kind: failure?.code === "OVERLAY_CAS_CONFLICT" ? "conflict" : "write", message: failure?.message ?? "The local writer returned no result.", file: target.file });
        return;
      }
      rememberUndo(result, target);
      setAnnouncement(`${draft.status.replaceAll("_", " ")} written locally for ${target.label}. Cursor advanced.`);
      setDraft(null);
      setTarget(null);
      setReasonConfirmed(false);
      onCommitted();
      advance(target.findingId);
    } catch (error) {
      setWriteError({ kind: conflict(error) ? "conflict" : "write", message: error instanceof Error ? error.message : "The local write failed.", file: target.file });
    } finally { setPending(false); }
  }, [advance, draft, onCommitted, platformProjectId, projectVersionId, reasonConfirmed, rememberUndo, rpc, target, workspaceProjectId]);

  const reloadTarget = useCallback(async () => {
    const row = target ? rows.find(candidate => candidate.findingId === target.findingId) : null;
    if (!row) return;
    setPending(true);
    try {
      const reloaded = await readExactTarget(row);
      setTarget(reloaded);
      setWriteError(null);
      setAnnouncement(`Reloaded CAS base for ${reloaded.label}; your draft was preserved.`);
    } catch (error) {
      setWriteError({ kind: "write", message: error instanceof Error ? error.message : "The CAS base could not be reloaded.", file: target?.file ?? null });
    } finally { setPending(false); }
  }, [readExactTarget, rows, target]);

  const undo = useCallback(async () => {
    const token = undoStack.current.peek();
    const entry = token ? undoEntries.current.get(token) : null;
    if (!token || !entry || !workspaceProjectId || !platformProjectId || !projectVersionId) {
      setAnnouncement("There is no local decision to undo in this session.");
      return;
    }
    setPending(true);
    try {
      await rpc.call("triageDecisionUndo", {
        workspaceProjectId,
        platformProjectId,
        projectVersionId,
        findingId: entry.target.findingId,
        stableKey: entry.target.stableKey,
        token: entry.rpcToken,
      });
      undoStack.current.accept(token);
      undoEntries.current.delete(token);
      setAnnouncement(`Undid the last local decision for ${entry.target.label}.`);
      onCommitted();
    } catch (error) {
      setAnnouncement(`Undo refused: ${error instanceof Error ? error.message : "the file changed after the decision"}. The newer YAML was preserved.`);
    } finally { setPending(false); }
  }, [onCommitted, platformProjectId, projectVersionId, rpc, workspaceProjectId]);

  const move = useCallback((delta: -1 | 1) => {
    if (rows.length === 0) return;
    const index = Math.max(0, rows.findIndex(row => row.findingId === cursorKey));
    const next = rows[Math.max(0, Math.min(rows.length - 1, index + delta))];
    if (!next) return;
    onCursor(next.findingId);
    anchorFindingId.current = next.findingId;
    window.requestAnimationFrame(() => rowElement(rows, next.findingId)?.focus());
  }, [cursorKey, onCursor, rows]);

  const toggle = useCallback((range: boolean) => {
    const row = currentRow(rows, cursorKey);
    if (!row) return;
    const isSelected = selection.mode === "explicit" ? selection.keys.has(row.stableKey) : !selection.excluded.has(row.stableKey);
    const anchor = anchorFindingId.current ? rows.find(candidate => candidate.findingId === anchorFindingId.current)?.stableKey ?? null : null;
    onSelection(row.stableKey, !isSelected, range, anchor);
    if (!range) anchorFindingId.current = row.findingId;
  }, [cursorKey, onSelection, rows, selection]);

  const shortcut = useCallback((command: TriageShortcut) => {
    if (command.action === "move") move(command.delta);
    else if (command.action === "open") { const row = currentRow(rows, cursorKey); if (row) onOpen(row.stableKey); }
    else if (command.action === "filter") { const input = document.querySelector('[aria-label="Filter component"]'); if (input instanceof HTMLElement) input.focus(); }
    else if (command.action === "toggle") toggle(false);
    else if (command.action === "range") toggle(true);
    else if (command.action === "bulk") setBulkOpen(true);
    else if (command.action === "undo") void undo();
    else if (command.action === "sheet") setSheet(true);
    else if (command.action === "status") {
      if (count > 0) { setBulkOpen(true); setBulkConfirming(true); const row = currentRow(rows, cursorKey); if (row) void readExactTarget(row).then(exact => { setTarget(exact); setDraft(draftFor(exact, command.status, false)); setReasonConfirmed(false); }); }
      else void beginSingle(command.status);
    }
  }, [beginSingle, count, cursorKey, move, onOpen, readExactTarget, rows, toggle, undo]);

  useFindingsShortcuts(active, shortcut);

  const loadBulkTargets = useCallback(async (): Promise<TriageTarget[]> => {
    if (!workspaceProjectId || !platformProjectId || !projectVersionId) throw new Error("Choose a findings scope before bulk triage.");
    if (selection.mode === "explicit") {
      const targets: TriageTarget[] = [];
      for (let index = 0; index < exactSelectedIds.length; index += TARGET_PAGE) {
        const result = await rpc.call("triageTargetsRead", {
          workspaceProjectId, platformProjectId, projectVersionId,
          selection: { mode: "exact", findingIds: exactSelectedIds.slice(index, index + TARGET_PAGE) }, continuation: null,
        });
        targets.push(...result.items);
      }
      return targets;
    }
    const targets: TriageTarget[] = [];
    let continuation: string | null = null;
    do {
      const result: { items: TriageTarget[]; total: number; next: string | null } = await rpc.call("triageTargetsRead", {
        workspaceProjectId, platformProjectId, projectVersionId,
        selection: { mode: "predicate", filters: selection.filter, excludedStableKeys: [...selection.excluded], total: selection.total }, continuation,
      });
      targets.push(...result.items);
      continuation = result.next;
    } while (continuation !== null);
    return targets;
  }, [exactSelectedIds, platformProjectId, projectVersionId, rpc, selection, workspaceProjectId]);

  const writeBulkTargets = useCallback(async (
    targets: readonly TriageTarget[],
    preservedFailures: readonly BulkFailure[] = [],
  ) => {
    if (!draft || !workspaceProjectId || !platformProjectId || !projectVersionId) return;
    const failures: BulkFailure[] = [...preservedFailures];
    const retryTargets: TriageTarget[] = [];
    let successes = 0;
    for (let index = 0; index < targets.length; index += WRITE_CHUNK) {
      const chunk = targets.slice(index, index + WRITE_CHUNK);
      const response = await rpc.call("triageDecisionsWrite", {
        workspaceProjectId, platformProjectId, projectVersionId,
        decisions: chunk.map(exact => ({
          findingId: exact.findingId, stableKey: exact.stableKey,
          status: draft.status, justification: draft.justification, response: draft.response,
          reason: draft.reason.trim().replaceAll("{evidence}", exact.evidence),
          evidence: draft.evidence.trim().replaceAll("{evidence}", exact.evidence), pin: draft.pin,
          expectedSha256: exact.expectedSha256,
        })),
      });
      response.results.forEach((result, resultIndex) => {
        const exact = chunk[resultIndex];
        if (!exact) return;
        if (result.success) { successes += 1; rememberUndo(result, exact); }
        else {
          failures.push({ findingId: result.findingId, stableKey: result.stableKey, message: result.message, retryable: result.retryable });
          if (result.retryable) retryTargets.push(exact);
        }
      });
      setAnnouncement(`Bulk local write progress: ${Math.min(index + chunk.length, targets.length)} of ${targets.length} attempted.`);
    }
    setBulkFailures(failures);
    setFailedTargets(retryTargets);
    setAnnouncement(`Bulk local writes finished: ${successes} succeeded, ${failures.length} failed. Successful YAML changes were preserved.`);
    if (successes > 0) onCommitted();
  }, [draft, onCommitted, platformProjectId, projectVersionId, rememberUndo, rpc, workspaceProjectId]);

  const confirmBulk = useCallback(async (retry = false) => {
    if (!draft || !reasonConfirmed || !validateTriageDraft(draft).ok) return;
    setPending(true);
    try {
      await writeBulkTargets(
        retry ? failedTargets : await loadBulkTargets(),
        retry ? bulkFailures.filter(failure => !failure.retryable) : [],
      );
    }
    catch (error) { setBulkFailures([{ findingId: "selection", stableKey: "selection", message: error instanceof Error ? error.message : "Bulk target loading failed.", retryable: false }]); }
    finally { setPending(false); }
  }, [bulkFailures, draft, failedTargets, loadBulkTargets, reasonConfirmed, writeBulkTargets]);

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
      <p aria-live="polite" className="sr-only" role="status">{announcement}</p>
      <div
        aria-description="Findings shortcuts: j and k navigate, Enter opens detail, slash focuses filters, x toggles selection, Shift-X selects a range, b opens bulk actions, u undoes, question mark opens help, and n/e/t/f/r/Shift-R choose VEX status."
        aria-keyshortcuts="j k Enter / x Shift+X b u Shift+/ n e t f r Shift+R"
        className="flex items-center justify-between border-y border-border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground"
      >
        <span>{readiness}</span>
        <Button aria-description="Open the complete keyboard shortcut reference" onClick={() => setSheet(true)} size="sm" variant="ghost"><Icon aria-hidden="true" className="size-3.5" name="CircleQuestion" />Shortcuts <kbd className="font-mono">?</kbd></Button>
      </div>
      {draft && target ? <TriageEditor draft={draft} error={writeError} onCancel={() => { setDraft(null); setTarget(null); setWriteError(null); }} onChange={setDraft} onCommit={count > 0 ? () => { setBulkConfirming(true); } : commitSingle} onReasonConfirmed={setReasonConfirmed} onReload={reloadTarget} pending={pending} reasonConfirmed={reasonConfirmed} seededReason={draft.reason === target.reasonSeed && target.reasonSeed.length > 0} targetLabel={count > 0 ? `${count.toLocaleString()} selected findings` : target.label} /> : null}
      <BulkDecisionBar confirming={bulkConfirming} count={count} failures={bulkFailures} onCancel={() => { setBulkConfirming(false); setBulkOpen(false); }} onConfirm={() => void confirmBulk(false)} onOpen={() => setBulkOpen(true)} onRetry={() => void confirmBulk(true)} onStatus={status => { setBulkConfirming(true); const row = currentRow(rows, cursorKey); if (row) void readExactTarget(row).then(exact => { setTarget(exact); setDraft(draftFor(exact, status, false)); setReasonConfirmed(false); }); }} open={bulkOpen} pending={pending} predicate={selection.mode === "predicate"} status={draft?.status ?? null} />
      {sheet ? <ShortcutSheet onOpenChange={setSheet} open /> : null}
    </>
  );
}

export function FindingsTriageStub({ kind }: { kind: "policy" | "import" }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center p-6">
      <div className="max-w-lg rounded-lg border border-border bg-card p-6 text-center">
        <Icon aria-hidden="true" className="mx-auto size-6 text-muted-foreground" name={kind === "policy" ? "SlidersHorizontal" : "Download"} />
        <h2 className="mt-3 text-base font-semibold">{kind === "policy" ? "Triage policy" : "Import findings"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">This route is reserved for its owning work package. Manual decisions are available on the findings table and write local YAML only.</p>
      </div>
    </div>
  );
}
