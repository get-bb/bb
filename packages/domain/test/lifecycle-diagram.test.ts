import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_LIFECYCLE,
  lifecyclePredicateNames,
  renderLifecycleMermaid,
  THREAD_LIFECYCLE,
  THREAD_LIFECYCLE_EVENT_PREDICATES,
} from "../src/index.js";

describe("renderLifecycleMermaid", () => {
  it("groups parallel edges with predicate labels", () => {
    const diagram = renderLifecycleMermaid({
      initial: "a",
      predicateNames: { go: ["notDeleted"], halt: [], retry: [] },
      table: {
        a: { go: "b", retry: "b" },
        b: { halt: "a", go: "b" },
      },
    });

    expect(diagram).toBe(
      [
        "flowchart LR",
        "    __start((start))",
        '    a["a"]',
        '    b["b"]',
        "    __start --> a",
        '    a -->|"go ⟨notDeleted⟩<br/>retry"| b',
        '    b -->|"halt"| a',
        '    b -->|"go ⟨notDeleted⟩"| b',
        "",
      ].join("\n"),
    );
  });

  it("renders path-dependent targets as two annotated edges", () => {
    const diagram = renderLifecycleMermaid({
      initial: "a",
      predicateNames: {},
      table: {
        a: {
          settle: { withWorkspacePath: "b", withoutWorkspacePath: "c" },
          same: { withWorkspacePath: "b", withoutWorkspacePath: "b" },
        },
        b: {},
        c: {},
      },
    });

    expect(diagram).toBe(
      [
        "flowchart LR",
        "    __start((start))",
        '    a["a"]',
        '    b["b"]',
        '    c["c"]',
        "    __start --> a",
        '    a -->|"settle (workspace on disk)<br/>same"| b',
        '    a -->|"settle (no workspace)"| c',
        "",
      ].join("\n"),
    );
  });
});

describe("docs/lifecycle-diagrams.md", () => {
  it("stays in sync with the lifecycle tables", async () => {
    const document = `${[
      "<!-- GENERATED FILE — do not edit by hand.",
      "     Source: packages/domain/src/thread-lifecycle.ts and",
      "     packages/domain/src/environment-lifecycle.ts.",
      "     Regenerate: pnpm --filter @bb/domain exec vitest run test/lifecycle-diagram.test.ts -u -->",
      "",
      "# Lifecycle state machines",
      "",
      "Rendered from `THREAD_LIFECYCLE` and `ENVIRONMENT_LIFECYCLE`.",
      "",
      "The thread table is the status projection of the persisted thread run",
      "machine in `apps/server/src/services/threads/lifecycle/machine.ts`. That",
      "machine also owns the turn requests awaiting a daemon answer, a turn",
      "completion held for them, and an owed or acknowledged stop, and it is the",
      "only writer of thread status. User requests, daemon command answers,",
      "daemon events and reports, the turn-start deadline and server restart are",
      "its inputs; each one picks the status moves below. The environment table",
      "is consumed by `applyEnvironmentLifecycleEvent` in `@bb/db`.",
      "",
      "How to read these: each edge groups all moves that transition between",
      "the same two statuses. A label is `move ⟨supersession predicates⟩`; the",
      "predicates are checked against the loaded row, and a failing predicate",
      "leaves the status where it is. An **absent** edge means the move is not",
      "available from that status.",
      "",
      "## Thread",
      "",
      "```mermaid",
      `${renderLifecycleMermaid({
        initial: "starting",
        predicateNames: lifecyclePredicateNames(
          THREAD_LIFECYCLE_EVENT_PREDICATES,
        ),
        table: THREAD_LIFECYCLE,
      }).trimEnd()}`,
      "```",
      "",
      "## Environment",
      "",
      "```mermaid",
      `${renderLifecycleMermaid({
        initial: "creating",
        predicateNames: {},
        table: ENVIRONMENT_LIFECYCLE,
      }).trimEnd()}`,
      "```",
    ].join("\n")}\n`;

    await expect(document).toMatchFileSnapshot(
      "../../../docs/lifecycle-diagrams.md",
    );
  });
});
