import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Class applied to the inline span wrapping each `ultracode` occurrence. The
 * animated purple-sparkle paint lives in app.css under this selector.
 */
export const ULTRACODE_HIGHLIGHT_CLASS = "prompt-ultracode-highlight";

/**
 * Matches the standalone word `ultracode`, case-insensitively. Word boundaries
 * keep it from lighting up substrings (e.g. `ultracodes`, `myultracode`) so the
 * highlight tracks the actual keyword the user typed.
 */
function ultracodePattern(): RegExp {
  return /\bultracode\b/gi;
}

/**
 * Collect the document ranges to highlight. Matching runs per text node, so a
 * word split across mark boundaries (e.g. partially bold) isn't detected — the
 * prompt box is plain text by default, so `ultracode` is a single text node in
 * the common case. Returns absolute `{ from, to }` positions in the doc.
 */
export function findUltracodeRanges(
  doc: ProseMirrorNode,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const pattern = ultracodePattern();
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(node.text)) !== null) {
      const from = pos + match.index;
      ranges.push({ from, to: from + match[0].length });
    }
  });
  return ranges;
}

/**
 * Decorates every `ultracode` keyword in the prompt editor with the
 * animated purple-sparkle treatment (matching Claude Code). Decorations are
 * recomputed from document state on each view update; the prompt is small, so
 * the full-doc scan is cheap.
 */
export const PromptUltracodeHighlightExtension = Extension.create({
  name: "promptUltracodeHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const ranges = findUltracodeRanges(state.doc);
            if (ranges.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              ranges.map(({ from, to }) =>
                Decoration.inline(from, to, {
                  class: ULTRACODE_HIGHLIGHT_CLASS,
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
