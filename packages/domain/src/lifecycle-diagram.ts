/**
 * Renders a lifecycle transition table as a Mermaid flowchart so the state
 * machine is reviewable visually. GitHub renders Mermaid in Markdown, so the
 * committed output shows the full machine in the repo and in PR diffs whenever
 * a transition changes.
 *
 * The generated document lives at docs/lifecycle-diagrams.md and is kept in
 * sync by a file-snapshot test (packages/domain/test/lifecycle-diagram.test.ts).
 */
/**
 * A table cell: either a plain target status, or a path-dependent branch
 * (the shape of EnvironmentLifecyclePathDependentTarget, accepted
 * structurally) rendered as two annotated edges.
 */
export interface LifecycleDiagramPathDependentTarget {
  withWorkspacePath: string;
  withoutWorkspacePath: string;
}

export type LifecycleDiagramTarget =
  | string
  | LifecycleDiagramPathDependentTarget;

export type LifecycleDiagramRow = Readonly<
  Partial<Record<string, LifecycleDiagramTarget>>
>;

export type LifecycleDiagramTable = Readonly<Record<string, LifecycleDiagramRow>>;

export type LifecycleDiagramPredicateNames = Readonly<
  Record<string, readonly string[]>
>;

export type LifecyclePredicateRecord = Readonly<Record<string, object>>;

interface LifecycleDiagramTransitionGroup {
  from: string;
  labels: string[];
  to: string;
}

interface LifecycleDiagramTransition {
  from: string;
  label: string;
  to: string;
}

export interface RenderLifecycleMermaidArgs {
  /** Status assigned at row creation; rendered from the synthetic start node. */
  initial: string;
  /**
   * Supersession predicate names per event, shown in the edge label as
   * `event ⟨notArchived, notDeleted⟩`. Events without predicates render
   * as the bare event name.
   */
  predicateNames: LifecycleDiagramPredicateNames;
  table: LifecycleDiagramTable;
}

export function renderLifecycleMermaid(
  args: RenderLifecycleMermaidArgs,
): string {
  const lines = ["flowchart LR", "    __start((start))"];
  for (const status of Object.keys(args.table)) {
    lines.push(`    ${status}["${status}"]`);
  }
  lines.push(`    __start --> ${args.initial}`);
  for (const group of createLifecycleDiagramTransitionGroups(args)) {
    lines.push(
      `    ${group.from} -->|${quoteMermaidEdgeLabel(
        group.labels.join("<br/>"),
      )}| ${group.to}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function quoteMermaidEdgeLabel(label: string): string {
  return `"${label.replaceAll('"', "#quot;")}"`;
}

function createLifecycleDiagramTransitionGroups(
  args: RenderLifecycleMermaidArgs,
): LifecycleDiagramTransitionGroup[] {
  const groups: LifecycleDiagramTransitionGroup[] = [];
  for (const [from, row] of Object.entries(args.table)) {
    for (const [event, to] of Object.entries(row)) {
      if (to === undefined) {
        continue;
      }
      const predicates = args.predicateNames[event] ?? [];
      const label =
        predicates.length > 0 ? `${event} ⟨${predicates.join(", ")}⟩` : event;
      if (typeof to === "string") {
        appendLifecycleDiagramTransitionGroup({
          groups,
          transition: { from, label, to },
        });
      } else if (to.withWorkspacePath === to.withoutWorkspacePath) {
        appendLifecycleDiagramTransitionGroup({
          groups,
          transition: { from, label, to: to.withWorkspacePath },
        });
      } else {
        appendLifecycleDiagramTransitionGroup({
          groups,
          transition: {
            from,
            label: `${label} (workspace on disk)`,
            to: to.withWorkspacePath,
          },
        });
        appendLifecycleDiagramTransitionGroup({
          groups,
          transition: {
            from,
            label: `${label} (no workspace)`,
            to: to.withoutWorkspacePath,
          },
        });
      }
    }
  }
  return groups;
}

interface AppendLifecycleDiagramTransitionGroupArgs {
  groups: LifecycleDiagramTransitionGroup[];
  transition: LifecycleDiagramTransition;
}

function appendLifecycleDiagramTransitionGroup({
  groups,
  transition,
}: AppendLifecycleDiagramTransitionGroupArgs): void {
  const existingGroup = groups.find(
    (group) => group.from === transition.from && group.to === transition.to,
  );
  if (existingGroup) {
    existingGroup.labels.push(transition.label);
    return;
  }
  groups.push({
    from: transition.from,
    labels: [transition.label],
    to: transition.to,
  });
}

/**
 * Extracts predicate names from a per-event predicate record (the shape of
 * THREAD_LIFECYCLE_EVENT_PREDICATES / ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES)
 * for use as RenderLifecycleMermaidArgs.predicateNames.
 */
export function lifecyclePredicateNames(
  predicates: LifecyclePredicateRecord,
): LifecycleDiagramPredicateNames {
  return Object.fromEntries(
    Object.entries(predicates).map(([event, flags]) => [
      event,
      Object.keys(flags),
    ]),
  );
}
