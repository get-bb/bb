/**
 * Renders a lifecycle transition table as a Mermaid `stateDiagram-v2` so the
 * state machine is reviewable visually — GitHub renders Mermaid in Markdown,
 * so the committed output shows the full machine in the repo and in PR
 * diffs whenever a transition changes.
 *
 * The generated document lives at docs/lifecycle-diagrams.md and is kept in
 * sync by a file-snapshot test (packages/domain/test/lifecycle-diagram.test.ts).
 */
/**
 * A table cell: either a plain target status, or a path-dependent branch
 * (the shape of EnvironmentLifecyclePathDependentTarget, accepted
 * structurally) rendered as two annotated edges.
 */
export type LifecycleDiagramTarget =
  | string
  | { withWorkspacePath: string; withoutWorkspacePath: string };

export interface RenderLifecycleMermaidArgs {
  /** Status assigned at row creation; rendered as the `[*]` entry edge. */
  initial: string;
  /**
   * Supersession predicate names per event, shown in the edge label as
   * `event ⟨notDeleted, notStopRequested⟩`. Events without predicates render
   * as the bare event name.
   */
  predicateNames: Readonly<Record<string, readonly string[]>>;
  table: Readonly<
    Record<string, Readonly<Partial<Record<string, LifecycleDiagramTarget>>>>
  >;
}

export function renderLifecycleMermaid(
  args: RenderLifecycleMermaidArgs,
): string {
  const lines = ["stateDiagram-v2", `    [*] --> ${args.initial}`];
  for (const [from, row] of Object.entries(args.table)) {
    for (const [event, to] of Object.entries(row)) {
      if (to === undefined) {
        continue;
      }
      const predicates = args.predicateNames[event] ?? [];
      const label =
        predicates.length > 0 ? `${event} ⟨${predicates.join(", ")}⟩` : event;
      if (typeof to === "string") {
        lines.push(`    ${from} --> ${to} : ${label}`);
      } else if (to.withWorkspacePath === to.withoutWorkspacePath) {
        lines.push(`    ${from} --> ${to.withWorkspacePath} : ${label}`);
      } else {
        lines.push(
          `    ${from} --> ${to.withWorkspacePath} : ${label} (workspace on disk)`,
          `    ${from} --> ${to.withoutWorkspacePath} : ${label} (no workspace)`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Extracts predicate names from a per-event predicate record (the shape of
 * THREAD_LIFECYCLE_EVENT_PREDICATES / ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES)
 * for use as RenderLifecycleMermaidArgs.predicateNames.
 */
export function lifecyclePredicateNames(
  predicates: Readonly<Record<string, object>>,
): Record<string, readonly string[]> {
  return Object.fromEntries(
    Object.entries(predicates).map(([event, flags]) => [
      event,
      Object.keys(flags),
    ]),
  );
}
