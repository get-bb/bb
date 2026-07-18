import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { PluginComposerTextEffect } from "@bb/plugin-sdk";

export const PROMPT_TEXT_SHIMMER_CLASS = "prompt-text-shimmer";

const promptTextEffectPluginKey = new PluginKey<PluginComposerTextEffect | null>(
  "promptTextEffect",
);

export function findPromptTextRanges(
  doc: ProseMirrorNode,
): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || node.nodeSize === 0) return;
    ranges.push({ from: pos, to: pos + node.nodeSize });
  });
  return ranges;
}

export function setPromptTextEffect(
  editor: Editor,
  effect: PluginComposerTextEffect | null,
): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(promptTextEffectPluginKey, effect),
  );
}

export const PromptTextEffectExtension = Extension.create({
  name: "promptTextEffect",
  addProseMirrorPlugins() {
    return [
      new Plugin<PluginComposerTextEffect | null>({
        key: promptTextEffectPluginKey,
        state: {
          init: () => null,
          apply(transaction, previous) {
            const next: unknown = transaction.getMeta(
              promptTextEffectPluginKey,
            );
            return next === "shimmer" || next === null ? next : previous;
          },
        },
        props: {
          decorations(state) {
            if (promptTextEffectPluginKey.getState(state) !== "shimmer") {
              return null;
            }
            return DecorationSet.create(
              state.doc,
              findPromptTextRanges(state.doc).map(({ from, to }) =>
                Decoration.inline(from, to, {
                  class: PROMPT_TEXT_SHIMMER_CLASS,
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
