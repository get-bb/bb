import { Icon } from "@bb/shared-ui/icon";

export function FindingsTriageStub({ kind }: { kind: "policy" | "import" }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center p-6">
      <div className="max-w-lg rounded-lg border border-border bg-card p-6 text-center">
        <Icon aria-hidden="true" className="mx-auto size-6 text-muted-foreground" name={kind === "policy" ? "SlidersHorizontal" : "Download"} />
        <h2 className="mt-3 text-base font-semibold">{kind === "policy" ? "Triage policy" : "Import findings"}</h2>
        <p className="mt-2 text-sm text-muted-foreground">WP-26 replaces this compiling route seam with the human triage workflow. No remote request or push action is available from this stub.</p>
      </div>
    </div>
  );
}
