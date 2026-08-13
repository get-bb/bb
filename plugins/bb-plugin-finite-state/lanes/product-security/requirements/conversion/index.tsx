import { useEffect, useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { useBbContext, useBbNavigate, useRpc } from "@bb/plugin-sdk/app";
import type { RpcContract } from "../../../../shared/contract.js";
import { ConversionDialog, type ConversionDialogModel } from "./ConversionDialog.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The scoped conversion request failed.";
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
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      const plan: { items: NonNullable<ConversionDialogModel["diff"]>; next: string | null } = await rpc.call("syncPlan", {
        projectId,
        projectVersionId: conversion.projectVersionId,
        pageSize: 200,
        continuation,
        kinds: ["requirement"],
      });
      items.push(...plan.items.filter((item) =>
        conversion.requirementIds.some((id) => item.label === id || item.label.includes(id)),
      ));
      continuation = plan.next;
      if (continuation === null) break;
    }
    return { ...conversion, diff: items };
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

  async function review(decision: "reviewed" | "discarded"): Promise<void> {
    if (!model || !projectId) return;
    setBusy(true);
    try {
      setModel(await rpc.call("earsConversionReview", {
        projectId,
        projectVersionId,
        id: model.id,
        decision,
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
          onDiscard={() => void review("discarded")}
          onEdit={() => {
            const first = model.requirementIds[0];
            if (first) navigate.toPluginPanel("product-security", { subPath: `requirements/${first}` });
          }}
          onRefresh={() => void refresh()}
          onReview={() => void review("reviewed")}
        />
      ) : null}
    </>
  );
}
