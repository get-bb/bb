import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";

installTestPluginRuntime();
const { EmptyOrError, LoadingPreview, WorkflowRunPanelState } =
  await import("./src/app.js");

export default { title: "plugins/Workflows/Workflow panel" };

const STATES = [
  ["Loading", null],
  ["Initial RPC error", "Could not load this workflow run."],
  ["No run", "No workflow runs were found for this thread."],
  ["Invalid parameters", "This workflow panel has invalid run parameters."],
] as const;

export function EarlyStates() {
  return (
    <main className="mx-auto w-full max-w-5xl p-6">
      <h1 className="text-sm font-semibold text-foreground">
        Flush workflow panel early states
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Each state should start 16px from both panel edges.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {STATES.map(([label, message]) => (
          <section key={label}>
            <h2 className="mb-1 text-xs text-muted-foreground">{label}</h2>
            <div className="h-32 w-full max-w-sm overflow-hidden border border-border-seam bg-border">
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
      </div>
    </main>
  );
}
