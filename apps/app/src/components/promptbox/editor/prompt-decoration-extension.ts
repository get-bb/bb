import type {
  ComposerRichTextSpec,
  ComposerStructuredDraft,
  ComposerView,
} from "@get-bb/plugin-sdk";
import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { PromptTextMention } from "@bb/domain";
import {
  promptEditorSerializationFromDoc,
  type PromptEditorOffsetSegment,
} from "./prompt-editor-serialization";

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
  effects: readonly PromptDecorationRule[];
}

export interface PromptDraftObserver {
  id: string;
  getView(): ComposerView;
  onDraftChange(draft: ComposerStructuredDraft, view: ComposerView): void;
}

export interface PromptDecorationExtensionOptions {
  /**
   * Returns current sources in composition order. Call
   * refreshPromptDecorations after generations or state effects change
   * without a document edit.
   */
  getDecorationSources?: () => readonly PromptDecorationSource[];
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
  revision: number;
  /**
   * A doc edit was absorbed by mapping the existing decorations instead of
   * rebuilding them; a deferred full rebuild is required.
   */
  rebuildPending: boolean;
}

const promptDecorationPluginKey = new PluginKey<PromptDecorationPluginState>(
  "promptDecorations",
);

/**
 * Transaction meta values understood by the plugin. `refresh` is the public
 * signal that decoration sources changed (bumps `revision`, so draft observers
 * re-run); `deferred-rebuild` only re-applies the current rules to a large doc
 * and must not look like a source change.
 */
type PromptDecorationMeta = "refresh" | "deferred-rebuild";

/**
 * Above this ProseMirror doc size (≈ characters), a doc edit no longer
 * rebuilds decorations synchronously. Rebuilding serializes the entire
 * document and runs every rule's `match` over the full text — several ms per
 * keystroke once a large paste (e.g. a 1 MB minified bundle) sits in the
 * composer, and unbounded for plugin-supplied rules. Instead, existing
 * decorations are mapped through the edit (so they stay anchored to their
 * text) and a full rebuild runs shortly afterwards via
 * PROMPT_DECORATION_LARGE_DOC_REBUILD_DELAY_MS. The only observable
 * difference on a large doc is that highlight additions/removals can lag the
 * edit by one rebuild interval.
 */
export const PROMPT_DECORATION_LARGE_DOC_SIZE = 100_000;
export const PROMPT_DECORATION_LARGE_DOC_REBUILD_DELAY_MS = 200;

const EMPTY_SOURCES: readonly PromptDecorationSource[] = [];
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

const BUILT_IN_HOST_SOURCE: PromptDecorationSource = {
  id: "host:ultracode",
  generation: 0,
  effects: [PROMPT_ULTRACODE_DECORATION_RULE],
};

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
  sources: readonly PromptDecorationSource[],
  disabledRules: Map<string, string | number>,
  onRuleError: PromptDecorationExtensionOptions["onRuleError"],
): DecorationSet | null {
  const serialization = promptEditorSerializationFromDoc(doc);
  const orderedSources: PromptDecorationSource[] = [
    BUILT_IN_HOST_SOURCE,
    ...sources,
  ];
  const decorations: Decoration[] = [];

  for (const [sourceIndex, source] of orderedSources.entries()) {
    for (const [ruleIndex, rule] of source.effects.entries()) {
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
                options.getDecorationSources?.() ?? EMPTY_SOURCES,
                disabledRules,
                options.onRuleError,
              ),
              revision: 0,
              rebuildPending: false,
            }),
            apply(transaction, previous, _oldState, newState) {
              const meta = promptDecorationMeta(transaction);
              const refreshed = meta === "refresh";
              if (meta === null && !transaction.docChanged) return previous;
              if (
                meta === null &&
                newState.doc.content.size > PROMPT_DECORATION_LARGE_DOC_SIZE
              ) {
                return {
                  decorations:
                    previous.decorations?.map(
                      transaction.mapping,
                      newState.doc,
                    ) ?? null,
                  revision: previous.revision,
                  rebuildPending: true,
                };
              }
              return {
                decorations: buildDecorations(
                  newState.doc,
                  options.getDecorationSources?.() ?? EMPTY_SOURCES,
                  disabledRules,
                  options.onRuleError,
                ),
                revision: refreshed ? previous.revision + 1 : previous.revision,
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
          view(initialView) {
            let timeout: ReturnType<typeof setTimeout> | null = null;
            let rebuildTimeout: ReturnType<typeof setTimeout> | null = null;
            let latestDoc = initialView.state.doc;
            // Throttled (not reset per keystroke) so continuous typing in a
            // large doc still refreshes matches at a bounded cadence.
            const scheduleDeferredRebuild = (view: typeof initialView) => {
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
            const schedule = (doc: ProseMirrorNode) => {
              latestDoc = doc;
              if (timeout !== null) clearTimeout(timeout);
              timeout = setTimeout(() => {
                timeout = null;
                const observers =
                  options.getDraftObservers?.() ?? EMPTY_OBSERVERS;
                // Serializing the whole doc is the expensive part; skip it
                // when no plugin is listening.
                if (observers.length === 0) return;
                const draft = composerStructuredDraftFromDoc(latestDoc);
                for (const observer of observers) {
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
                const previousPluginState =
                  promptDecorationPluginKey.getState(previousState);
                const nextPluginState = promptDecorationPluginKey.getState(
                  updatedView.state,
                );
                if (
                  !updatedView.state.doc.eq(previousState.doc) ||
                  previousPluginState?.revision !== nextPluginState?.revision
                ) {
                  schedule(updatedView.state.doc);
                }
                if (nextPluginState?.rebuildPending) {
                  scheduleDeferredRebuild(updatedView);
                } else if (rebuildTimeout !== null) {
                  clearTimeout(rebuildTimeout);
                  rebuildTimeout = null;
                }
              },
              destroy() {
                if (timeout !== null) clearTimeout(timeout);
                if (rebuildTimeout !== null) clearTimeout(rebuildTimeout);
              },
            };
          },
        }),
      ];
    },
  });
