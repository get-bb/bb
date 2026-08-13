import { useEffect, useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { useBbContext, useBbNavigate, useRpc } from "@bb/plugin-sdk/app";
import type { RpcContract } from "../../../../shared/contract.js";
import { ConversionDialog, type ConversionDialogModel } from "./ConversionDialog.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The scoped conversion request failed.";
}

const MAX_SYNC_PLAN_PAGES = 50;

export function exactRequirementDiffItems(
  items: NonNullable<ConversionDialogModel["diff"]>,
  requirementIds: readonly string[],
): NonNullable<ConversionDialogModel["diff"]> {
  const selected = new Set(requirementIds);
  return items.filter((item) => selected.has(item.label));
}

export function requirementEditSubPath(requirementId: string): string {
  return `requirements/trace/${requirementId}`;
}

export function conversionDiffIsComplete(
  items: NonNullable<ConversionDialogModel["diff"]>,
  requirementIds: readonly string[],
  continuation: string | null,
): boolean {
  if (continuation !== null) return false;
  const shownIds = new Set(items.map((item) => item.label));
  return requirementIds.every((id) => shownIds.has(id));
}

export function RequirementsConversionLayer({
  projectId: selectedProjectId,
}: {
  projectId?: string;
} = {}): React.JSX.Element | null {
  const { projectId: routeProjectId } = useBbContext();
  const projectId = selectedProjectId ?? routeProjectId;
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const [projectVersionId, setProjectVersionId] = useState<string | null>(null);
  const [model, setModel] = useState<ConversionDialogModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withDiff(conversion: ConversionDialogModel): Promise<ConversionDialogModel> {
    if (conversion.state !== "awaiting_human" || !projectId) return conversion;
    const items: NonNullable<ConversionDialogModel["diff"]> = [];
    let continuation: string | null = null;
    let pageIndex = 0;
    do {
      const plan: { items: NonNullable<ConversionDialogModel["diff"]>; next: string | null } = await rpc.call("syncPlan", {
        projectId,
        projectVersionId: conversion.projectVersionId,
        pageSize: 200,
        continuation,
        kinds: ["requirement"],
      });
      items.push(...exactRequirementDiffItems(plan.items, conversion.requirementIds));
      continuation = plan.next;
      pageIndex += 1;
    } while (continuation !== null && pageIndex < MAX_SYNC_PLAN_PAGES);
    const diffComplete = conversionDiffIsComplete(items, conversion.requirementIds, continuation);
    return { ...conversion, diff: items, diffComplete };
  }

  useEffect(() => {
    setProjectVersionId(null);
    setModel(null);
    setError(null);
  }, [projectId]);

  async function start(): Promise<void> {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const conversion = await rpc.call("earsConversionStart", {
        projectId,
        projectVersionId,
      });
      setProjectVersionId(conversion.projectVersionId);
      setModel(await withDiff(conversion));
    } catch (nextError) {
      setError(message(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function refresh(): Promise<void> {
    if (!model || !projectId) return;
    setBusy(true);
    try {
      const conversion = await rpc.call("earsConversionGet", {
        projectId,
        projectVersionId,
        id: model.id,
      });
      setModel(await withDiff(conversion));
    } catch (nextError) {
      setError(message(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function discard(): Promise<void> {
    if (!model || !projectId) return;
    setBusy(true);
    try {
      setModel(await rpc.call("earsConversionReview", {
        projectId,
        projectVersionId,
        id: model.id,
        decision: "discarded",
        expectedSnapshotSha256: model.snapshotSha256,
      }));
    } catch (nextError) {
      setError(message(nextError));
    } finally {
      setBusy(false);
    }
  }

  if (!projectId) {
    return (
      <div className="fixed bottom-5 right-5 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground shadow-lg" role="status">
        Choose a project before converting requirements.
      </div>
    );
  }

  return (
    <>
      <div className="fixed bottom-5 right-5 z-30 flex items-center gap-2">
        {error ? <span className="max-w-sm rounded-md border border-destructive/40 bg-card px-3 py-2 text-sm text-destructive" role="alert">{error}</span> : null}
        <button className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" disabled={busy} onClick={() => void start()} type="button">
          <Icon aria-hidden="true" className={busy ? "size-4 animate-spin" : "size-4"} name={busy ? "Spinner" : "EditFile"} />
          {busy ? "Preparing conversion" : "Convert to EARS"}
        </button>
      </div>
      {model ? (
        <ConversionDialog
          model={model}
          onClose={() => setModel(null)}
          onDiscard={() => void discard()}
          onEdit={() => {
            const first = model.requirementIds[0];
            if (first) navigate.toPluginPanel("product-security", { subPath: requirementEditSubPath(first) });
          }}
          onRefresh={() => void refresh()}
        />
      ) : null}
    </>
  );
}
