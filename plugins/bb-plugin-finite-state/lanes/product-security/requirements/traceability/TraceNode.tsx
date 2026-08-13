import { Icon, type IconName } from "@bb/shared-ui/icon";
import type { TraceNodeModel } from "./resolvers.js";

const ICONS: Record<TraceNodeModel["kind"], IconName> = {
  threat: "Lock",
  requirement: "FileText",
  clause: "Explore",
  commit: "GitBranch",
  check: "CircleCheck",
  run: "Workflow",
  attestation: "CircleCheck",
};

function title(kind: TraceNodeModel["kind"]): string {
  return kind === "attestation" ? "signed evidence" : kind;
}

export function TraceNode({
  node,
  onNavigate,
}: {
  node: TraceNodeModel;
  onNavigate?(subPath: string): void;
}): React.JSX.Element {
  const body = (
    <article
      aria-label={`${title(node.kind)} ${node.id}: ${node.ready ? "ready" : "not ready"}`}
      className="flex h-full min-h-40 flex-col rounded-lg border border-border bg-card p-3 text-left text-card-foreground shadow-xs transition-colors group-hover:border-primary/50"
    >
      <header className="flex items-center gap-2">
        <span className={node.ready ? "rounded-md bg-success/10 p-1.5 text-success" : "rounded-md bg-warning/10 p-1.5 text-warning"}>
          <Icon aria-hidden="true" className="size-4" name={ICONS[node.kind]} />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title(node.kind)}</span>
        <span className={node.ready ? "ml-auto size-2 rounded-full bg-success" : "ml-auto size-2 rounded-full bg-warning"} />
      </header>
      <p className="mt-3 line-clamp-2 font-mono text-xs font-semibold text-foreground">{node.id}</p>
      <p className="mt-1 line-clamp-2 text-sm leading-5">{node.label}</p>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{node.relation}</p>
      {node.error ? <p className="mt-2 text-xs text-warning">{node.error}</p> : null}
      {node.provenance ? (
        <p className="mt-auto border-t border-border pt-2 text-xs text-muted-foreground">
          {node.provenance.source}{node.provenance.at ? ` · ${node.provenance.at}` : ""}
        </p>
      ) : null}
    </article>
  );
  return node.navigation && onNavigate ? (
    <button
      aria-label={node.navigation.label}
      className="group h-full w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onNavigate(node.navigation?.subPath ?? "")}
      type="button"
    >
      {body}
    </button>
  ) : body;
}
