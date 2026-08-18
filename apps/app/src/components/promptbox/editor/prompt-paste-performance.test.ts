/**
 * Composer synthetic large-paste microbenchmark. NOT part of the normal suite:
 * every case is gated behind PROMPTBOX_PERF=1 because wall-clock timings are
 * meaningless as pass/fail signals on shared CI machines.
 *
 * Run (the repo vitest config silences console output of passing tests, so
 * the two extra flags are required to see the timings):
 *   cd apps/app
 *   PROMPTBOX_PERF=1 pnpm exec vitest run --silent=false \
 *     --disableConsoleIntercept \
 *     src/components/promptbox/editor/prompt-paste-performance.test.ts
 *
 * Write the paste fixture to a file for manual (Electron) testing:
 *   PROMPTBOX_PERF=1 PROMPTBOX_PERF_FIXTURE_OUT=/tmp/minified-paste-fixture.js \
 *     pnpm exec vitest run \
 *     src/components/promptbox/editor/prompt-paste-performance.test.ts
 *
 * What it measures (per fixture size): isolated synchronous JS primitives the
 * composer invokes when a synthetic minified single-line blob is pasted or
 * edited. This is not an end-to-end editor transaction benchmark. DOM/layout
 * cost (ProseMirror view updates, line wrapping of a 1 MB line) is not
 * measurable here and must be profiled in Electron.
 *
 * Some rows measure primitives that were REMOVED from the per-keystroke path
 * (value-key JSON.stringify, per-keystroke draft serialization, synchronous
 * decoration rebuilds on large docs, full-document trigger scans); they are
 * kept so the cost being avoided stays visible. See each row's label.
 *
 * Manual Electron repro (macOS):
 * 1. Build/run the desktop app on the target machine.
 * 2. Generate the fixture file (command above) and copy its contents
 *    (a single ~1 MB line of minified-JS-shaped text) to the clipboard,
 *    e.g. `cat /tmp/minified-paste-fixture.js | pbcopy`.
 * 3. Open a thread, focus the composer, start a Performance recording in
 *    DevTools (or `--trace-startup`-style tracing), paste, then type ~20
 *    characters and scroll the thread.
 * 4. Compare against the same recording on the baseline build: long tasks on
 *    paste, per-keystroke main-thread time, dropped frames while typing, and
 *    input latency (Interactions track). Rich-text Markdown preference ON is
 *    the worst case for paste/mount; default settings exercise the
 *    per-keystroke path.
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Node } from "@tiptap/pm/model";
import { PromptMentionExtension } from "./prompt-mention-extension";
import {
  promptEditorContentFromValue,
  promptEditorInlineContentFromValue,
  promptEditorValueFromDoc,
} from "./prompt-editor-serialization";
import { findUltracodeRanges } from "./prompt-decoration-extension";
import { findActiveTrigger } from "../mentions/find-active-trigger";
import type { TypeaheadTrigger } from "../mentions/types";
import { serializePromptDraftStorage } from "@/lib/prompt-draft";
import { generateMinifiedJsFixture } from "@/test/fixtures/minified-js-paste-fixture";

const PERF_ENABLED = process.env.PROMPTBOX_PERF === "1";

const schema = getSchema([
  StarterKit.configure({
    blockquote: {},
    bold: {},
    bulletList: {},
    code: {},
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: {},
    horizontalRule: false,
    italic: {},
    link: false,
    listItem: {},
    orderedList: {},
    strike: false,
    underline: false,
  }),
  PromptMentionExtension,
]);

const TRIGGERS: readonly TypeaheadTrigger[] = [
  { char: "@", kind: "mention" },
  { char: "/", kind: "command" },
];

const FIXTURE_SIZES = [128 * 1024, 512 * 1024, 1024 * 1024] as const;

/** Median of `iterations` timed runs (ms). */
function measureMs(iterations: number, run: () => unknown): number {
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)]!;
}

function formatMs(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}

describe.runIf(PERF_ENABLED)("composer large minified-JS paste", () => {
  const fixtureOut = process.env.PROMPTBOX_PERF_FIXTURE_OUT;
  if (fixtureOut) {
    it("writes the manual-repro fixture file", () => {
      const text = generateMinifiedJsFixture({
        approximateLength: 1024 * 1024,
      });
      writeFileSync(fixtureOut, text);
      console.log(
        `fixture written: ${fixtureOut} (${text.length} chars, single line)`,
      );
      expect(text.length).toBeGreaterThan(1024 * 1024);
    });
  }

  for (const size of FIXTURE_SIZES) {
    const label = `${Math.round(size / 1024)}KB`;

    it(`measures paste + per-keystroke hot path at ${label}`, () => {
      const text = generateMinifiedJsFixture({ approximateLength: size });
      const value = { text, mentions: [] };
      const lines: string[] = [`--- fixture ${label} (${text.length} chars)`];

      // Paste-time work (default settings: rich-text Markdown OFF).
      const plainPasteMs = measureMs(5, () =>
        promptEditorInlineContentFromValue(value),
      );
      lines.push(
        `paste: inline content (plain)          ${formatMs(plainPasteMs)}ms`,
      );

      // Paste/mount-time work with the rich-text Markdown preference ON
      // (also runs on every external setContent of the draft).
      const richMs = measureMs(3, () =>
        promptEditorContentFromValue(value, { richTextMarkdown: true }),
      );
      lines.push(
        `paste/mount: content (richTextMarkdown) ${formatMs(richMs)}ms`,
      );

      // Build the document the editor holds after the paste.
      const doc = Node.fromJSON(schema, {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: promptEditorInlineContentFromValue(value),
          },
        ],
      });

      // Per-keystroke synchronous work while the pasted blob is in the box.
      const serializeMs = measureMs(7, () => promptEditorValueFromDoc(doc));
      lines.push(
        `keystroke: full-doc serialize (×1)     ${formatMs(serializeMs)}ms`,
      );

      const valueKeyMs = measureMs(7, () => JSON.stringify(value));
      lines.push(
        `value JSON.stringify (2×/keystroke pre-fix; now ref-compare) ${formatMs(valueKeyMs)}ms`,
      );

      const decorationRegexMs = measureMs(7, () => findUltracodeRanges(text));
      lines.push(
        `decoration rule regex (sync/keystroke pre-fix; now deferred on large docs) ${formatMs(decorationRegexMs)}ms`,
      );

      const caretEditor = {
        state: {
          selection: { empty: true, from: doc.content.size - 1 },
          doc,
        },
      };
      const triggerMs = measureMs(7, () =>
        findActiveTrigger(caretEditor, TRIGGERS),
      );
      lines.push(
        `keystroke: findActiveTrigger           ${formatMs(triggerMs)}ms`,
      );

      const draft = { text, mentions: [], attachments: [] };
      const draftSerializeMs = measureMs(7, () =>
        serializePromptDraftStorage(draft),
      );
      lines.push(
        `draft JSON serialize (per keystroke pre-fix; now per 250ms flush) ${formatMs(draftSerializeMs)}ms`,
      );

      console.log(lines.join("\n"));
      expect(text.length).toBeGreaterThanOrEqual(size);
      expect(text).not.toContain("\n");
    });
  }
});

// Keep vitest happy when the perf gate is off: a file with zero runnable
// tests fails the run.
describe.runIf(!PERF_ENABLED)("composer paste perf harness (gated)", () => {
  it("is skipped unless PROMPTBOX_PERF=1", () => {
    expect(PERF_ENABLED).toBe(false);
  });
});
