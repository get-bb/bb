import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { LinkReadiness } from "./LinkReadiness.js";
import type {
  CrossSurfaceLink,
  CrossSurfaceLinkKind,
  ResolvedCrossSurfaceLinks,
} from "./schema.js";

export type CrossSurfaceLinksState =
  | { state: "loading" }
  | { state: "unconfigured" }
  | { state: "error"; message: string }
  | { state: "ready"; result: ResolvedCrossSurfaceLinks };

export interface CrossSurfaceLinksProps {
  value: CrossSurfaceLinksState;
  onNavigate(link: CrossSurfaceLink): void;
  onRetry(): void;
  onSafeAction(
    kind: CrossSurfaceLinkKind,
    reason: "not_pulled" | "not_mapped" | "unavailable",
  ): void;
}
function LoadingLinks(): React.JSX.Element {
  return (
    <div aria-label="Loading connected surfaces" className="space-y-2" role="status">
      {[0, 1, 2, 3].map((row) => (
        <div
          className="h-14 animate-pulse rounded-md border border-border bg-muted"
          key={row}
        />
      ))}
      <span className="sr-only">Loading cross-surface links</span>
    </div>
  );
}

export function CrossSurfaceLinks({
  value,
  onNavigate,
  onRetry,
  onSafeAction,
}: CrossSurfaceLinksProps): React.JSX.Element {
  return (
    <section
      aria-label="Connected surfaces"
      className="border-t border-border px-4 py-3"
      data-canvas-cross-surface-links=""
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 text-primary" name="ExternalLink" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Connected surfaces
        </h3>
      </div>

      {value.state === "loading" ? <LoadingLinks /> : null}

      {value.state === "unconfigured" ? (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
          <p className="font-medium">Choose a project to resolve links</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The canvas remains available, but mappings are project-scoped.
          </p>
        </div>
      ) : null}

      {value.state === "error" ? (
        <div
          className="rounded-md border border-destructive/40 bg-background p-3 text-sm"
          role="alert"
        >
          <div className="flex gap-2">
            <Icon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-destructive"
              name="AlertTriangle"
            />
            <div>
              <p className="font-medium">Links could not be loaded</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {value.message}
              </p>
              <Button className="mt-2" onClick={onRetry} size="sm" variant="outline">
                <Icon aria-hidden="true" className="size-4" name="RotateCcw" />
                Retry links
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {value.state === "ready" ? (
        <ul className="space-y-2">
          {value.result.links.map((link, index) => (
            <LinkReadiness
              key={`${link.kind}:${link.target || link.reason || index}`}
              link={link}
              onNavigate={onNavigate}
              onSafeAction={onSafeAction}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
