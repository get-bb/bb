import type {
  ComposerRichTextSpec,
  ComposerStructuredDraft,
  ComposerView,
  PluginComposerTextEffect,
} from "@bb/plugin-sdk";
import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { PromptTextMention } from "@bb/domain";
import {
  promptEditorSerializationFromDoc,
  type PromptEditorOffsetSegment,
} from "./prompt-editor-serialization";

export const PROMPT_TEXT_SHIMMER_CLASS = "prompt-text-shimmer";
export const ULTRACODE_HIGHLIGHT_CLASS = "prompt-ultracode-highlight";

export interface PromptDecorationRange {
  from: number;
  to: number;
}

/** One public ComposerRichTextSpec content-derived effect entry. */
export type PromptDecorationRule = NonNullable<
  ComposerRichTextSpec["effects"]
>[number];

/**
 * One host or plugin contribution to the decoration engine. Generations must
 * change when a plugin registration is replaced so a rule disabled after a
 * thrown match can be retried for the new registration.
 */
export interface PromptDecorationSource {
  id: string;
  generation: string | number;
  pluginId?: string;
  effects?: readonly PromptDecorationRule[];
  textEffect?: PluginComposerTextEffect | null;
}

/** Host entries paint before plugin entries; array order is preserved. */
export interface PromptDecorationSources {
  host?: readonly PromptDecorationSource[];
  plugins?: readonly PromptDecorationSource[];
}

export interface PromptDraftObserver {
  id: string;
  getView(): ComposerView;
  onDraftChange(draft: ComposerStructuredDraft, view: ComposerView): void;
}

export interface PromptDecorationExtensionOptions {
  /**
   * Returns current host and plugin sources. Keep plugin entries in composer
   * composition order and call refreshPromptDecorations after generations or
   * state effects change without a document edit.
   */
  getDecorationSources?: () => PromptDecorationSources;
  /**
   * Returns the currently registered richText.onDraftChange callbacks and
   * their latest ComposerView snapshots. Callback order is preserved.
   */
  getDraftObservers?: () => readonly PromptDraftObserver[];
  /** Draft observation debounce; defaults to 100 ms. */
  draftObserverDebounceMs?: number;
  /** Optional host logger for an isolated rich-text match failure. */
  onRuleError?: (sourceId: string, ruleId: string, error: unknown) => void;
  /** Optional host logger for an isolated draft observer failure. */
  onDraftObserverError?: (observerId: string, error: unknown) => void;
}

interface PromptDecorationPluginState {
  decorations: DecorationSet | null;
  effect: { className: string } | null;
  revision: number;
}

type PromptDecorationCommand =
  | { type: "effect"; effect: PluginComposerTextEffect | null }
  | { type: "refresh" };

const promptDecorationPluginKey = new PluginKey<PromptDecorationPluginState>(
  "promptDecorations",
);

const EMPTY_SOURCES: PromptDecorationSources = {};
const EMPTY_OBSERVERS: readonly PromptDraftObserver[] = [];

function ultracodePattern(): RegExp {
  return /\bultracode\b/giu;
}

export function findUltracodeRanges(text: string): PromptDecorationRange[] {
  const ranges: PromptDecorationRange[] = [];
  const pattern = ultracodePattern();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
}

/** Built-in host rule, intentionally shaped exactly like a public effect. */
export const PROMPT_ULTRACODE_DECORATION_RULE: PromptDecorationRule = {
  id: "ultracode",
  match: findUltracodeRanges,
  className: ULTRACODE_HIGHLIGHT_CLASS,
};

/** Built-in host whole-draft effect used by the legacy "shimmer" sugar. */
export const PROMPT_SHIMMER_TEXT_EFFECT = {
  className: PROMPT_TEXT_SHIMMER_CLASS,
} as const;

const BUILT_IN_HOST_SOURCE: PromptDecorationSource = {
  id: "host:ultracode",
  generation: 0,
  effects: [PROMPT_ULTRACODE_DECORATION_RULE],
};

function normalizeTextEffect(
  effect: PluginComposerTextEffect | null,
): { className: string } | null {
  if (effect === "shimmer") return PROMPT_SHIMMER_TEXT_EFFECT;
  if (effect === null) return null;
  return effect.className.length > 0 ? effect : null;
}

function parseCommand(value: unknown): PromptDecorationCommand | null {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return null;
  }
  if (value.type === "refresh") return { type: "refresh" };
  if (value.type !== "effect" || !("effect" in value)) return null;
  const effect = value.effect;
  if (effect === null || effect === "shimmer") {
    return { type: "effect", effect };
  }
  if (
    typeof effect === "object" &&
    effect !== null &&
    "className" in effect &&
    typeof effect.className === "string"
  ) {
    return { type: "effect", effect: { className: effect.className } };
  }
  return null;
}

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

function wholeDraftDecorations(
  doc: ProseMirrorNode,
  mapping: readonly PromptEditorOffsetSegment[],
  className: string,
  spec: Record<string, string>,
): Decoration[] {
  return mapping.flatMap((segment) => {
    const decoration = decorationForIntersection(
      doc,
      segment,
      { from: segment.textFrom, to: segment.textTo },
      className,
      spec,
    );
    return decoration === null ? [] : [decoration];
  });
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

function defaultObserverErrorLogger(observerId: string, error: unknown): void {
  console.warn(
    `[composer-draft-observer:${observerId}] onDraftChange failed`,
    error,
  );
}

function buildDecorations(
  doc: ProseMirrorNode,
  stateEffect: { className: string } | null,
  sources: PromptDecorationSources,
  disabledRules: Map<string, string | number>,
  onRuleError: PromptDecorationExtensionOptions["onRuleError"],
): DecorationSet | null {
  const serialization = promptEditorSerializationFromDoc(doc);
  const orderedSources: PromptDecorationSource[] = [
    BUILT_IN_HOST_SOURCE,
    ...(stateEffect === null
      ? []
      : [
          {
            id: "host:imperative-text-effect",
            generation: 0,
            textEffect: stateEffect,
          },
        ]),
    ...(sources.host ?? []),
    ...(sources.plugins ?? []),
  ];
  const decorations: Decoration[] = [];

  for (const [sourceIndex, source] of orderedSources.entries()) {
    const normalizedEffect = normalizeTextEffect(source.textEffect ?? null);
    if (normalizedEffect !== null) {
      decorations.push(
        ...wholeDraftDecorations(
          doc,
          serialization.offsetMapping,
          normalizedEffect.className,
          {
            className: normalizedEffect.className,
            ...(source.pluginId
              ? { "data-bb-plugin-decoration": source.pluginId }
              : {}),
            sourceId: source.id,
            sourceOrder: String(sourceIndex),
          },
        ),
      );
    }

    for (const [ruleIndex, rule] of (source.effects ?? []).entries()) {
      const failureKey = `${source.id}\0${rule.id}\0${ruleIndex}`;
      const disabledGeneration = disabledRules.get(failureKey);
      if (disabledGeneration === source.generation) continue;
      if (disabledGeneration !== undefined) disabledRules.delete(failureKey);

      let ranges: PromptDecorationRange[];
      try {
        const result: unknown = rule.match(serialization.text);
        const parsed = parseRanges(result);
        if (parsed === null) {
          throw new TypeError("match must return valid integer ranges");
        }
        ranges = parsed;
      } catch (error) {
        disabledRules.set(failureKey, source.generation);
        (onRuleError ?? defaultRuleErrorLogger)(source.id, rule.id, error);
        continue;
      }

      for (const range of ranges) {
        if (range.from >= serialization.text.length) {
          continue;
        }
        const boundedRange = {
          from: range.from,
          to: Math.min(range.to, serialization.text.length),
        };
        for (const segment of serialization.offsetMapping) {
          const decoration = decorationForIntersection(
            doc,
            segment,
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
      }
    }
  }

  return decorations.length === 0
    ? null
    : DecorationSet.create(doc, decorations);
}

function structuredMention(
  mention: PromptTextMention,
): ComposerStructuredDraft["mentions"][number] {
  const { resource } = mention;
  if (resource.kind === "plugin") {
    const separator = resource.itemId.indexOf(":");
    return {
      from: mention.start,
      to: mention.end,
      provider:
        separator === -1
          ? resource.pluginId
          : resource.itemId.slice(0, separator),
      id:
        separator === -1
          ? resource.itemId
          : resource.itemId.slice(separator + 1),
      label: resource.label,
    };
  }

  let id: string;
  if (resource.kind === "thread") id = resource.threadId;
  else if (resource.kind === "project") id = resource.projectId;
  else if (resource.kind === "section") id = resource.sectionId;
  else if (resource.kind === "path") id = resource.path;
  else id = `${resource.trigger}${resource.name}`;
  return {
    from: mention.start,
    to: mention.end,
    provider: resource.kind,
    id,
    label: resource.label,
  };
}

export function composerStructuredDraftFromDoc(
  doc: ProseMirrorNode,
): ComposerStructuredDraft {
  const value = promptEditorSerializationFromDoc(doc);
  return {
    text: value.text,
    mentions: value.mentions.map(structuredMention),
  };
}

export function setPromptTextEffect(
  editor: Editor,
  effect: PluginComposerTextEffect | null,
): void {
  const command: PromptDecorationCommand = { type: "effect", effect };
  editor.view.dispatch(
    editor.state.tr.setMeta(promptDecorationPluginKey, command),
  );
}

export function refreshPromptDecorations(editor: Editor): void {
  const command: PromptDecorationCommand = { type: "refresh" };
  editor.view.dispatch(
    editor.state.tr.setMeta(promptDecorationPluginKey, command),
  );
}

/** Testing/diagnostic access to this extension's current decoration set. */
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
        getDraftObservers: () => EMPTY_OBSERVERS,
        draftObserverDebounceMs: 100,
      };
    },
    addProseMirrorPlugins() {
      const disabledRules = new Map<string, string | number>();
      const options = this.options;
      return [
        new Plugin<PromptDecorationPluginState>({
          key: promptDecorationPluginKey,
          state: {
            init: (_config, state) => ({
              decorations: buildDecorations(
                state.doc,
                null,
                options.getDecorationSources?.() ?? EMPTY_SOURCES,
                disabledRules,
                options.onRuleError,
              ),
              effect: null,
              revision: 0,
            }),
            apply(transaction, previous, _oldState, newState) {
              const command = parseCommand(
                transaction.getMeta(promptDecorationPluginKey),
              );
              if (command === null && !transaction.docChanged) return previous;
              const effect =
                command?.type === "effect"
                  ? normalizeTextEffect(command.effect)
                  : previous.effect;
              return {
                decorations: buildDecorations(
                  newState.doc,
                  effect,
                  options.getDecorationSources?.() ?? EMPTY_SOURCES,
                  disabledRules,
                  options.onRuleError,
                ),
                effect,
                revision:
                  command === null ? previous.revision : previous.revision + 1,
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
          view(initialView) {
            let timeout: ReturnType<typeof setTimeout> | null = null;
            let latestDoc = initialView.state.doc;
            const schedule = (doc: ProseMirrorNode) => {
              latestDoc = doc;
              if (timeout !== null) clearTimeout(timeout);
              timeout = setTimeout(() => {
                timeout = null;
                const draft = composerStructuredDraftFromDoc(latestDoc);
                for (const observer of options.getDraftObservers?.() ??
                  EMPTY_OBSERVERS) {
                  try {
                    observer.onDraftChange(draft, observer.getView());
                  } catch (error) {
                    (
                      options.onDraftObserverError ?? defaultObserverErrorLogger
                    )(observer.id, error);
                  }
                }
              }, options.draftObserverDebounceMs ?? 100);
            };
            schedule(initialView.state.doc);
            return {
              update(updatedView, previousState) {
                latestDoc = updatedView.state.doc;
                const previousRevision =
                  promptDecorationPluginKey.getState(previousState)?.revision;
                const nextRevision = promptDecorationPluginKey.getState(
                  updatedView.state,
                )?.revision;
                if (
                  !updatedView.state.doc.eq(previousState.doc) ||
                  previousRevision !== nextRevision
                ) {
                  schedule(updatedView.state.doc);
                }
              },
              destroy() {
                if (timeout !== null) clearTimeout(timeout);
              },
            };
          },
        }),
      ];
    },
  });
