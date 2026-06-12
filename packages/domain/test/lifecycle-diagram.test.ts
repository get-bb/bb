import { describe, expect, it } from "vitest";
import {
  ENVIRONMENT_LIFECYCLE,
  ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES,
  lifecyclePredicateNames,
  renderLifecycleMermaid,
  THREAD_LIFECYCLE,
  THREAD_LIFECYCLE_EVENT_PREDICATES,
} from "../src/index.js";

describe("renderLifecycleMermaid", () => {
  it("renders one edge per table cell with predicate labels", () => {
    const diagram = renderLifecycleMermaid({
      initial: "a",
      predicateNames: { go: ["notDeleted"], halt: [] },
      table: {
        a: { go: "b" },
        b: { halt: "a", go: "b" },
      },
    });

    expect(diagram).toBe(
      [
        "stateDiagram-v2",
        "    [*] --> a",
        "    a --> b : go ⟨notDeleted⟩",
        "    b --> a : halt",
        "    b --> b : go ⟨notDeleted⟩",
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
        "stateDiagram-v2",
        "    [*] --> a",
        "    a --> b : settle (workspace on disk)",
        "    a --> c : settle (no workspace)",
        "    a --> b : same",
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
      "Rendered from `THREAD_LIFECYCLE` and `ENVIRONMENT_LIFECYCLE` — the",
      "transition tables consumed by the CAS single-writers in `@bb/db`",
      "(`applyThreadLifecycleEvent` / `applyEnvironmentLifecycleEvent`).",
      "",
      "How to read these: an edge label is `event ⟨supersession predicates⟩`;",
      "the predicates are checked against the loaded row inside the writer's",
      "transaction, and a failing predicate makes the event a logged no-op.",
      "An **absent** edge means the event is a no-op in that status (the",
      "writer returns `illegal-transition`). The tables are behavior-neutral",
      "with the pre-table code; questionable-but-preserved transitions are",
      "annotated `// observed:` in the source files, and the per-call-site",
      "inventory lives in the headers of",
      "`packages/domain/test/thread-lifecycle.test.ts` and",
      "`packages/domain/test/environment-lifecycle.test.ts`.",
      "",
      "## Thread",
      "",
      "```mermaid",
      `${renderLifecycleMermaid({
        initial: "created",
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
        initial: "provisioning",
        predicateNames: lifecyclePredicateNames(
          ENVIRONMENT_LIFECYCLE_EVENT_PREDICATES,
        ),
        table: ENVIRONMENT_LIFECYCLE,
      }).trimEnd()}`,
      "```",
    ].join("\n")}\n`;

    await expect(document).toMatchFileSnapshot(
      "../../../docs/lifecycle-diagrams.md",
    );
  });
});
