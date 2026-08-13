import { useCallback, useEffect, useState } from "react";
import {
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
} from "@bb/plugin-sdk/app";
import { Alert, AlertDescription } from "@bb/shared-ui/alert";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  type authoringToolchainRpcContract,
  type ToolchainAdvisory,
} from "./toolchain-advisory-contract.js";
import { AUTHORING_TOOLCHAIN_CHANGED_CHANNEL } from "./toolchain-advisory-channel.js";

type PanelState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; advisory: ToolchainAdvisory };

function LoadingState(): React.JSX.Element {
  return (
    <div aria-label="Detecting firmware helpers" className="space-y-3 p-5" role="status">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function ToolchainAdvisoryPanel(
  _props: PluginNavPanelProps,
): React.JSX.Element {
  const rpc = useRpc<typeof authoringToolchainRpcContract>();
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [reviewing, setReviewing] = useState(false);
  const load = useCallback(async () => {
    try {
      const advisory = await rpc.call("authoringToolchainStatus", null);
      setState({ kind: "ready", advisory });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "Firmware helper status could not be read.",
      });
    }
  }, [rpc]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useRealtime(AUTHORING_TOOLCHAIN_CHANGED_CHANNEL, () => { void load(); });

  return (
    <section className="h-full overflow-y-auto bg-background p-4 text-foreground md:p-5">
      <div className="mx-auto max-w-4xl space-y-4">
        <header>
          <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Host-local advisory</p>
          <h1 className="mt-1 text-base font-semibold">Firmware Authoring</h1>
        </header>
        {state.kind === "loading" ? <LoadingState /> : null}
        {state.kind === "error" ? (
          <Alert className="border-destructive/40">
            <Icon className="size-4 text-destructive" name="AlertTriangle" />
            <AlertDescription className="space-y-3">
              <p>{state.message}</p>
              <Button onClick={() => { setState({ kind: "loading" }); void load(); }} size="sm" variant="outline">Retry status read</Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {state.kind === "ready" ? (
          <Alert>
            <Icon className="size-4" name={state.advisory.state === "ready" ? "CircleCheck" : "AlertCircle"} />
            <AlertDescription>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">
                  {state.advisory.state === "ready"
                    ? "Firmware helpers available"
                    : state.advisory.state === "degraded"
                      ? "Firmware helpers partially available"
                      : state.advisory.state === "detecting"
                        ? "Detecting firmware helpers"
                        : state.advisory.state === "error"
                          ? "Firmware helper detection failed"
                          : "Firmware helpers unavailable"}
                </p>
                <Badge variant="outline">{state.advisory.state}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{state.advisory.message}</p>
              {state.advisory.missing.length > 0 ? (
                <Button className="mt-4" onClick={() => setReviewing((value) => !value)} size="sm" variant="outline">
                  Review helper install
                </Button>
              ) : null}
              {reviewing ? (
                <div className="mt-3 rounded-md border border-border bg-background p-3">
                  <p className="text-xs font-medium">Manual host prerequisites</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Finite State does not install or modify host toolchains. Install only the helpers required by the authoring capability you intend to use, then reload the plugin to re-detect.</p>
                  <ul className="mt-3 space-y-1 font-mono text-xs">
                    {state.advisory.missing.map((tool) => (
                      <li key={`${tool.unlocks}:${tool.id}`}>{tool.unlocks} · {tool.id}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  );
}
