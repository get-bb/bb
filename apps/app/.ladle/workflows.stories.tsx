import { useEffect, useState } from "react";
import { PluginSlotMount } from "../src/components/plugin/PluginSlotMount";
import {
  installTestPluginRuntime,
  loadPluginApp,
} from "@get-bb/plugin-sdk/testing/app";
import * as workflowAppModule from "../../../plugins/workflows/src/app.js";
import type { WorkflowRunView } from "../../../plugins/workflows/src/ui-contract.js";

installTestPluginRuntime();
const { EmptyOrError, LoadingPreview, WorkflowRunPanelState } =
  workflowAppModule;
const workflowPanelPromise = loadPluginApp(async () => workflowAppModule).then(
  (workflowApp) =>
    workflowApp.threadPanelActions.find(
      (registration) => registration.id === "workflow-run",
    )!,
);

export default { title: "plugins/Workflows/Workflow panel" };

const STATES = [
  ["Loading", null],
  ["Initial RPC error", "Could not load this workflow run."],
  ["No run", "No workflow runs were found for this thread."],
  ["Invalid parameters", "This workflow panel has invalid run parameters."],
] as const;

const LOADED_RUN: WorkflowRunView = {
  id: "wfr_11111111-1111-4111-8111-111111111111",
  name: "Review the release",
  description: "Run independent checks before shipping.",
  status: "succeeded",
  currentPhase: null,
  phases: [
    {
      title: "Review",
      detail: "Challenge the combined result.",
      calls: [
        {
          id: "wfc_1",
          index: 0,
          label: "Adversarial review",
          phase: "Review",
          status: "succeeded",
          provider: "codex",
          model: "gpt-5.6",
          reasoningLevel: "high",
          cached: false,
          childThreadId: "thr_worker_1",
          providerRetryAttempts: 0,
          repairAttempts: 0,
          error: null,
          createdAt: 1_700_000_000_000,
          startedAt: 1_700_000_001_000,
          finishedAt: 1_700_000_011_000,
        },
      ],
    },
  ],
  unphasedCalls: [],
  resultAvailable: true,
  error: null,
  createdAt: 1_700_000_000_000,
  startedAt: 1_700_000_001_000,
  finishedAt: 1_700_000_012_000,
};

function LoadedPanel() {
  const [ready, setReady] = useState(false);
  const [workflowPanel, setWorkflowPanel] = useState<
    Awaited<typeof workflowPanelPromise> | undefined
  >(undefined);
  useEffect(() => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === "/api/v1/plugins/workflows/rpc/workflowRunView") {
        return new Response(
          JSON.stringify({ ok: true, result: { run: LOADED_RUN } }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return originalFetch(input, init);
    };
    setReady(true);
    return () => {
      globalThis.fetch = originalFetch;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void workflowPanelPromise.then((panel) => {
      if (!cancelled) setWorkflowPanel(panel);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  if (workflowPanel === undefined) return null;
  const Panel = workflowPanel.component;
  return (
    <div className="h-72 w-full max-w-sm overflow-hidden border border-border-seam">
      {ready ? (
        <PluginSlotMount
          pluginId="workflows"
          slotKind="threadPanelActions"
          slotId="workflow-run"
        >
          <Panel threadId="thr_origin" params={{ runId: LOADED_RUN.id }} />
        </PluginSlotMount>
      ) : null}
    </div>
  );
}

export function PanelStates() {
  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <h1 className="text-sm font-semibold text-foreground">
        Flush workflow panel states
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Early and loaded content should start 16px from both panel edges.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {STATES.map(([label, message]) => (
          <section key={label}>
            <h2 className="mb-1 text-xs text-muted-foreground">{label}</h2>
            <div className="w-full max-w-sm overflow-hidden border border-border-seam bg-border">
              <WorkflowRunPanelState>
                {message === null ? (
                  <LoadingPreview />
                ) : (
                  <EmptyOrError>{message}</EmptyOrError>
                )}
              </WorkflowRunPanelState>
            </div>
          </section>
        ))}
        <section className="sm:col-span-2">
          <h2 className="mb-1 text-xs text-muted-foreground">Loaded</h2>
          <LoadedPanel />
        </section>
      </div>
    </main>
  );
}
