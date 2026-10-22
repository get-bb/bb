import type { ComposerRichTextSpec } from "@get-bb/plugin-sdk";
import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import {
  promptEditorSerializationFromDoc,
  type PromptEditorOffsetSegment,
} from "./prompt-editor-serialization";

interface PromptDecorationRange {
  from: number;
  to: number;
}

type PromptDecorationRule = NonNullable<
  ComposerRichTextSpec["effects"]
>[number];

export interface PromptDecorationSource {
  id: string;
  generation: string | number;
  pluginId?: string;
  effects: readonly PromptDecorationRule[];
}

export interface PromptDecorationExtensionOptions {
  getDecorationSources?: () => readonly PromptDecorationSource[];
  onRuleError?: (sourceId: string, ruleId: string, error: unknown) => void;
}

interface PromptDecorationPluginState {
  decorations: DecorationSet | null;
  caretRanges: CaretRangeDecorations[];
  longestCaretRange: number;
  matched: PromptDecorationMatches;
  caretLines: PromptDecorationRange | null;
  focused: boolean;
  revision: number;
  rebuildPending: boolean;
}

const promptDecorationPluginKey = new PluginKey<PromptDecorationPluginState>(
  "promptDecorations",
);

type PromptDecorationMeta = "refresh" | "deferred-rebuild";

export const PROMPT_DECORATION_LARGE_DOC_SIZE = 100_000;
export const PROMPT_DECORATION_LARGE_DOC_REBUILD_DELAY_MS = 200;

const EMPTY_SOURCES: readonly PromptDecorationSource[] = [];

function parseRanges(value: unknown): PromptDecorationRange[] | null {
  if (!Array.isArray(value)) return null;
  const ranges: PromptDecorationRange[] = [];
  for (const range of value) {
    if (
      typeof range !== "object" ||
      range === null ||
      !("from" in range) ||
      !("to" in range) ||
      typeof range.from !== "number" ||
      typeof range.to !== "number" ||
      !Number.isInteger(range.from) ||
      !Number.isInteger(range.to) ||
      range.from < 0 ||
      range.to <= range.from
    ) {
      return null;
    }
    ranges.push({ from: range.from, to: range.to });
  }
  return ranges;
}

function decorationForIntersection(
  doc: ProseMirrorNode,
  segment: PromptEditorOffsetSegment,
  range: PromptDecorationRange,
  className: string,
  spec: Record<string, string>,
): Decoration | null {
  const textFrom = Math.max(segment.textFrom, range.from);
  const textTo = Math.min(segment.textTo, range.to);
  if (textFrom >= textTo) return null;

  if (segment.kind === "mention") {
    if (range.from > segment.textFrom || range.to < segment.textTo) {
      return null;
    }
    const node = doc.nodeAt(segment.docFrom);
    if (node === null) return null;
    return Decoration.node(
      segment.docFrom,
      segment.docTo,
      { class: className },
      spec,
    );
  }

  const docFrom = segment.docFrom + textFrom - segment.textFrom;
  const docTo = segment.docFrom + textTo - segment.textFrom;
  return docFrom < docTo
    ? Decoration.inline(docFrom, docTo, { class: className }, spec)
    : null;
}

function defaultRuleErrorLogger(
  sourceId: string,
  ruleId: string,
  error: unknown,
): void {
  console.warn(
    `[composer-decoration:${sourceId}/${ruleId}] match failed; disabled until the next plugin generation`,
    error,
  );
}

type PromptEditorSerialization = ReturnType<
  typeof promptEditorSerializationFromDoc
>;

interface PromptDecorationMatch {
  sourceIndex: number;
  ruleIndex: number;
  source: PromptDecorationSource;
  rule: PromptDecorationRule;
  ranges: PromptDecorationRange[];
}

interface PromptDecorationMatches {
  serialization: PromptEditorSerialization;
  matches: PromptDecorationMatch[];
  hasCaretRules: boolean;
}

function matchDecorationRules(
  doc: ProseMirrorNode,
  sources: readonly PromptDecorationSource[],
  disabledRules: Map<string, string | number>,
  onRuleError: PromptDecorationExtensionOptions["onRuleError"],
): PromptDecorationMatches {
  const serialization = promptEditorSerializationFromDoc(doc);
  const matches: PromptDecorationMatch[] = [];
  let hasCaretRules = false;

  for (const [sourceIndex, source] of sources.entries()) {
    for (const [ruleIndex, rule] of source.effects.entries()) {
      const failureKey = `${source.id}\0${rule.id}\0${ruleIndex}`;
      const disabledGeneration = disabledRules.get(failureKey);
      if (disabledGeneration === source.generation) continue;
      if (disabledGeneration !== undefined) disabledRules.delete(failureKey);

      let ranges: PromptDecorationRange[];
      try {
        const parsed = parseRanges(rule.match(serialization.text));
        if (parsed === null) {
          throw new TypeError("match must return valid integer ranges");
        }
        ranges = parsed;
      } catch (error) {
        disabledRules.set(failureKey, source.generation);
        (onRuleError ?? defaultRuleErrorLogger)(source.id, rule.id, error);
        continue;
      }
      if (ranges.length === 0) continue;
      if (rule.experimental_skipAtCaret === "line") {
        hasCaretRules = true;
      }
      matches.push({ sourceIndex, ruleIndex, source, rule, ranges });
    }
  }

  return { serialization, matches, hasCaretRules };
}

function promptCaretLines(
  state: Pick<EditorState, "doc" | "selection">,
  text: string,
): PromptDecorationRange {
  const { doc, selection } = state;
  const fromOffset = promptEditorSerializationFromDoc(
    doc.cut(0, selection.from),
  ).text.length;
  const toOffset = selection.empty
    ? fromOffset
    : promptEditorSerializationFromDoc(doc.cut(0, selection.to)).text.length;
  const lineStart = text.lastIndexOf("\n", fromOffset - 1) + 1;
  const nextBreak = text.indexOf("\n", toOffset);
  return { from: lineStart, to: nextBreak === -1 ? text.length : nextBreak };
}

function rangeTouchesLines(
  range: PromptDecorationRange,
  lines: PromptDecorationRange,
): boolean {
  return range.from <= lines.to && range.to >= lines.from;
}

function sameLines(
  left: PromptDecorationRange | null,
  right: PromptDecorationRange | null,
): boolean {
  return left?.from === right?.from && left?.to === right?.to;
}

function firstSegmentEndingAfter(
  segments: readonly PromptEditorOffsetSegment[],
  offset: number,
): number {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (segments[middle]!.textTo > offset) high = middle;
    else low = middle + 1;
  }
  return low;
}

interface CaretRangeDecorations {
  range: PromptDecorationRange;
  decorations: Decoration[];
}

interface PromptDecorationPaint {
  decorations: DecorationSet | null;
  caretRanges: CaretRangeDecorations[];
  longestCaretRange: number;
}

function rangeDecorations(
  doc: ProseMirrorNode,
  serialization: PromptEditorSerialization,
  { sourceIndex, ruleIndex, source, rule }: PromptDecorationMatch,
  range: PromptDecorationRange,
): Decoration[] {
  const decorations: Decoration[] = [];
  const boundedRange = {
    from: range.from,
    to: Math.min(range.to, serialization.text.length),
  };
  const segments = serialization.offsetMapping;
  for (
    let index = firstSegmentEndingAfter(segments, boundedRange.from);
    index < segments.length && segments[index]!.textFrom < boundedRange.to;
    index += 1
  ) {
    const decoration = decorationForIntersection(
      doc,
      segments[index]!,
      boundedRange,
      rule.className,
      {
        className: rule.className,
        ...(source.pluginId
          ? { "data-bb-plugin-decoration": source.pluginId }
          : {}),
        ruleId: rule.id,
        sourceId: source.id,
        sourceOrder: `${sourceIndex}:${ruleIndex}`,
      },
    );
    if (decoration !== null) decorations.push(decoration);
  }
  return decorations;
}

function paintDecorations(
  doc: ProseMirrorNode,
  matched: PromptDecorationMatches,
  caretLines: PromptDecorationRange | null,
): PromptDecorationPaint {
  const { serialization } = matched;
  const decorations: Decoration[] = [];
  const caretRanges: CaretRangeDecorations[] = [];
  let longestCaretRange = 0;

  for (const match of matched.matches) {
    const skipsCaretLine = match.rule.experimental_skipAtCaret === "line";
    for (const range of match.ranges) {
      if (range.from >= serialization.text.length) continue;
      const painted = rangeDecorations(doc, serialization, match, range);
      if (!skipsCaretLine) {
        decorations.push(...painted);
        continue;
      }
      caretRanges.push({ range, decorations: painted });
      longestCaretRange = Math.max(longestCaretRange, range.to - range.from);
      if (caretLines === null || !rangeTouchesLines(range, caretLines)) {
        decorations.push(...painted);
      }
    }
  }
  caretRanges.sort((left, right) => left.range.from - right.range.from);

  return {
    decorations:
      decorations.length === 0 ? null : DecorationSet.create(doc, decorations),
    caretRanges,
    longestCaretRange,
  };
}

function caretRangesTouching(
  paint: Pick<PromptDecorationPaint, "caretRanges" | "longestCaretRange">,
  lines: PromptDecorationRange,
): CaretRangeDecorations[] {
  const { caretRanges } = paint;
  let low = 0;
  let high = caretRanges.length;
  const earliestStart = lines.from - paint.longestCaretRange;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (caretRanges[middle]!.range.from < earliestStart) low = middle + 1;
    else high = middle;
  }
  const touching: CaretRangeDecorations[] = [];
  for (
    let index = low;
    index < caretRanges.length && caretRanges[index]!.range.from <= lines.to;
    index += 1
  ) {
    if (rangeTouchesLines(caretRanges[index]!.range, lines)) {
      touching.push(caretRanges[index]!);
    }
  }
  return touching;
}

function moveCaretLines(
  doc: ProseMirrorNode,
  previous: Pick<
    PromptDecorationPluginState,
    "decorations" | "caretRanges" | "longestCaretRange" | "caretLines"
  >,
  caretLines: PromptDecorationRange | null,
): DecorationSet | null {
  const hide =
    caretLines === null
      ? []
      : caretRangesTouching(previous, caretLines).filter(
          ({ range }) =>
            previous.caretLines === null ||
            !rangeTouchesLines(range, previous.caretLines),
        );
  const reveal =
    previous.caretLines === null
      ? []
      : caretRangesTouching(previous, previous.caretLines).filter(
          ({ range }) =>
            caretLines === null || !rangeTouchesLines(range, caretLines),
        );
  let decorations = previous.decorations ?? DecorationSet.empty;
  if (reveal.length > 0) {
    decorations = decorations.add(
      doc,
      reveal.flatMap((entry) => entry.decorations),
    );
  }
  if (hide.length > 0) {
    decorations = decorations.remove(
      hide.flatMap((entry) => entry.decorations),
    );
  }
  return decorations === DecorationSet.empty ? null : decorations;
}

function caretLinesFor(
  state: EditorState,
  matched: PromptDecorationMatches,
  focused: boolean,
): PromptDecorationRange | null {
  return focused && matched.hasCaretRules
    ? promptCaretLines(state, matched.serialization.text)
    : null;
}

export function refreshPromptDecorations(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(
      promptDecorationPluginKey,
      "refresh" satisfies PromptDecorationMeta,
    ),
  );
}

function promptDecorationMeta(
  transaction: Transaction,
): PromptDecorationMeta | null {
  const meta: unknown = transaction.getMeta(promptDecorationPluginKey);
  return meta === "refresh" || meta === "deferred-rebuild" ? meta : null;
}

export function getPromptDecorationSet(
  state: EditorState,
): DecorationSet | null {
  return promptDecorationPluginKey.getState(state)?.decorations ?? null;
}

export const PromptDecorationExtension =
  Extension.create<PromptDecorationExtensionOptions>({
    name: "promptDecorations",
    addOptions() {
      return {
        getDecorationSources: () => EMPTY_SOURCES,
      };
    },
    addProseMirrorPlugins() {
      const disabledRules = new Map<string, string | number>();
      const options = this.options;
      return [
        new Plugin<PromptDecorationPluginState>({
          key: promptDecorationPluginKey,
          state: {
            init: (_config, state) => {
              const matched = matchDecorationRules(
                state.doc,
                options.getDecorationSources?.() ?? EMPTY_SOURCES,
                disabledRules,
                options.onRuleError,
              );
              return {
                ...paintDecorations(state.doc, matched, null),
                matched,
                caretLines: null,
                focused: false,
                revision: 0,
                rebuildPending: false,
              };
            },
            apply(transaction, previous, _oldState, newState) {
              const meta = promptDecorationMeta(transaction);
              const focused =
                transaction.getMeta("focus") !== undefined
                  ? true
                  : transaction.getMeta("blur") !== undefined
                    ? false
                    : previous.focused;
              const rebuild =
                meta === "refresh" ||
                meta === "deferred-rebuild" ||
                transaction.docChanged;
              if (!rebuild) {
                if (previous.rebuildPending) {
                  return focused === previous.focused
                    ? previous
                    : { ...previous, focused };
                }
                if (focused === previous.focused && !transaction.selectionSet) {
                  return previous;
                }
                const caretLines = caretLinesFor(
                  newState,
                  previous.matched,
                  focused,
                );
                if (sameLines(caretLines, previous.caretLines)) {
                  return focused === previous.focused
                    ? previous
                    : { ...previous, focused };
                }
                return {
                  ...previous,
                  decorations: moveCaretLines(
                    newState.doc,
                    previous,
                    caretLines,
                  ),
                  caretLines,
                  focused,
                };
              }
              if (
                meta === null &&
                newState.doc.content.size > PROMPT_DECORATION_LARGE_DOC_SIZE
              ) {
                return {
                  ...previous,
                  decorations:
                    previous.decorations?.map(
                      transaction.mapping,
                      newState.doc,
                    ) ?? null,
                  focused,
                  rebuildPending: true,
                };
              }
              const matched = matchDecorationRules(
                newState.doc,
                options.getDecorationSources?.() ?? EMPTY_SOURCES,
                disabledRules,
                options.onRuleError,
              );
              const caretLines = caretLinesFor(newState, matched, focused);
              return {
                ...paintDecorations(newState.doc, matched, caretLines),
                matched,
                caretLines,
                focused,
                revision:
                  meta === "refresh"
                    ? previous.revision + 1
                    : previous.revision,
                rebuildPending: false,
              };
            },
          },
          props: {
            decorations(state) {
              return (
                promptDecorationPluginKey.getState(state)?.decorations ?? null
              );
            },
          },
          view() {
            let rebuildTimeout: ReturnType<typeof setTimeout> | null = null;
            const scheduleDeferredRebuild = (view: EditorView) => {
              if (rebuildTimeout !== null) return;
              rebuildTimeout = setTimeout(() => {
                rebuildTimeout = null;
                if (view.isDestroyed) return;
                view.dispatch(
                  view.state.tr.setMeta(
                    promptDecorationPluginKey,
                    "deferred-rebuild" satisfies PromptDecorationMeta,
                  ),
                );
              }, PROMPT_DECORATION_LARGE_DOC_REBUILD_DELAY_MS);
            };
            return {
              update(updatedView) {
                const nextPluginState = promptDecorationPluginKey.getState(
                  updatedView.state,
                );
                if (nextPluginState?.rebuildPending) {
                  scheduleDeferredRebuild(updatedView);
                } else if (rebuildTimeout !== null) {
                  clearTimeout(rebuildTimeout);
                  rebuildTimeout = null;
                }
              },
              destroy() {
                if (rebuildTimeout !== null) clearTimeout(rebuildTimeout);
              },
            };
          },
        }),
      ];
    },
  });
