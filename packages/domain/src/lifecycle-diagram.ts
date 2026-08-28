import { z } from "zod";

interface LifecycleDiagramPathDependentTarget {
  withWorkspacePath: string;
  withoutWorkspacePath: string;
}

type LifecycleDiagramTarget = string | LifecycleDiagramPathDependentTarget;

type LifecycleDiagramRow = Readonly<
  Partial<Record<string, LifecycleDiagramTarget>>
>;

type LifecycleDiagramTable = Readonly<Record<string, LifecycleDiagramRow>>;

type LifecycleDiagramPredicateNames = Readonly<
  Record<string, readonly string[]>
>;

const lifecycleDiagramPathDependentTargetSchema = z.object({
  withWorkspacePath: z.string(),
  withoutWorkspacePath: z.string(),
});

const lifecyclePredicateRecordSchema = z.record(
  z.string(),
  z.record(z.string(), z.boolean()),
);

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

interface RenderLifecycleMermaidArgs {
  initial: string;
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
      const stringTarget = z.string().safeParse(to);
      if (stringTarget.success) {
        appendLifecycleDiagramTransitionGroup({
          groups,
          transition: { from, label, to: stringTarget.data },
        });
        continue;
      }
      const pathDependentTarget =
        lifecycleDiagramPathDependentTargetSchema.parse(to);
      if (
        pathDependentTarget.withWorkspacePath ===
        pathDependentTarget.withoutWorkspacePath
      ) {
        appendLifecycleDiagramTransitionGroup({
          groups,
          transition: {
            from,
            label,
            to: pathDependentTarget.withWorkspacePath,
          },
        });
      } else {
        appendLifecycleDiagramTransitionGroup({
          groups,
          transition: {
            from,
            label: `${label} (workspace on disk)`,
            to: pathDependentTarget.withWorkspacePath,
          },
        });
        appendLifecycleDiagramTransitionGroup({
          groups,
          transition: {
            from,
            label: `${label} (no workspace)`,
            to: pathDependentTarget.withoutWorkspacePath,
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

export function lifecyclePredicateNames<T>(
  predicates: T,
): LifecycleDiagramPredicateNames {
  const parsedPredicates = lifecyclePredicateRecordSchema.parse(predicates);
  return Object.fromEntries(
    Object.entries(parsedPredicates).map(([event, flags]) => [
      event,
      Object.keys(flags),
    ]),
  );
}
