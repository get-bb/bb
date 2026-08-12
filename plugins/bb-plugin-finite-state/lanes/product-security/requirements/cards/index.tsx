import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../../../lib/context.js";

export function RequirementsCards(): React.JSX.Element {
  return (
    <section className="mx-auto w-full max-w-3xl p-5">
      <div className="rounded-lg border border-border bg-card p-5 text-card-foreground">
        <p className="text-sm font-medium">Requirements foundation reserved</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Requirement cards arrive in WP-36 without another registration edit.
        </p>
      </div>
    </section>
  );
}

export function registerRequirementsCardsBackend(
  _bb: BbPluginApi,
  _ctx: PluginContext,
): void {
  // WP-36 replaces this lane-local registration seam.
}
