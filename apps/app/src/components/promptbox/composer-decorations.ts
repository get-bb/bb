import type {
  ComposerRichTextSpec,
  ComposerStructuredDraft,
  ComposerView,
} from "@get-bb/plugin-sdk";
import type { PromptTextMention } from "@bb/domain";
import { composerScopeIdentity } from "@/components/plugin/plugin-composer-host";
import type { ComposerTextEffectSource } from "@/lib/composer-text-effects";
import type { PromptDecorationSource } from "./editor/prompt-decoration-extension";

export const ULTRACODE_HIGHLIGHT_CLASS = "prompt-ultracode-highlight";

const DRAFT_OBSERVER_DEBOUNCE_MS = 100;

interface DecorationRange {
  from: number;
  to: number;
}

export function findUltracodeRanges(text: string): DecorationRange[] {
  const ranges: DecorationRange[] = [];
  const pattern = /\bultracode\b/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
}

const ULTRACODE_DECORATION_SOURCE: PromptDecorationSource = {
  id: "host:ultracode",
  generation: 0,
  effects: [
    {
      id: "ultracode",
      match: findUltracodeRanges,
      className: ULTRACODE_HIGHLIGHT_CLASS,
    },
  ],
};

interface PluginDecorationContribution {
  pluginId: string;
  customizationId: string;
  generation: number;
  effects: NonNullable<ComposerRichTextSpec["effects"]>;
}

export function composerDecorationSources(
  pluginEffects: readonly PluginDecorationContribution[],
  textEffects: readonly ComposerTextEffectSource[],
): PromptDecorationSource[] {
  const sources: PromptDecorationSource[] = [ULTRACODE_DECORATION_SOURCE];
  for (const contribution of pluginEffects) {
    sources.push({
      id: `${contribution.pluginId}/${contribution.customizationId}`,
      generation: contribution.generation,
      pluginId: contribution.pluginId,
      effects: contribution.effects,
    });
  }
  for (const effectSource of textEffects) {
    const className = effectSource.effect.className;
    if (className.length === 0) continue;
    sources.push({
      id: `plugin-imperative:${effectSource.pluginId}:${effectSource.order}`,
      generation: effectSource.order,
      pluginId: effectSource.pluginId,
      effects: [
        {
          id: "whole-draft",
          className,
          match: (text) =>
            text.length === 0 ? [] : [{ from: 0, to: text.length }],
        },
      ],
    });
  }
  return sources;
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
  else if (resource.kind === "path" || resource.kind === "attachment")
    id = resource.path;
  else id = `${resource.trigger}${resource.name}`;
  return {
    from: mention.start,
    to: mention.end,
    provider: resource.kind,
    id,
    label: resource.label,
  };
}

export interface ComposerDraftObserver {
  pluginId: string;
  customizationId: string;
  onDraftChange(draft: ComposerStructuredDraft, view: ComposerView): void;
}

export interface DraftObserverInput {
  text: string;
  mentions: readonly PromptTextMention[];
  view: ComposerView;
  observers: readonly ComposerDraftObserver[];
}

export interface DraftObserverRunner {
  update(input: DraftObserverInput): void;
  dispose(): void;
}

export function createDraftObserverRunner(
  debounceMs = DRAFT_OBSERVER_DEBOUNCE_MS,
): DraftObserverRunner {
  let latest: DraftObserverInput | null = null;
  let notified: {
    text: string;
    mentions: readonly PromptTextMention[];
    observers: readonly ComposerDraftObserver[];
    scope: string;
  } | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const notify = () => {
    timeout = null;
    if (latest === null) return;
    const { text, mentions, view, observers } = latest;
    notified = {
      text,
      mentions,
      observers,
      scope: composerScopeIdentity(view.scope),
    };
    if (observers.length === 0) return;
    const draft: ComposerStructuredDraft = {
      text,
      mentions: mentions.map(structuredMention),
    };
    for (const observer of observers) {
      try {
        observer.onDraftChange(draft, view);
      } catch (error) {
        console.warn(
          `[composer-draft-observer:${observer.pluginId}/${observer.customizationId}] onDraftChange failed`,
          error,
        );
      }
    }
  };

  return {
    update(input) {
      latest = input;
      if (
        notified !== null &&
        notified.text === input.text &&
        notified.mentions === input.mentions &&
        notified.observers === input.observers &&
        notified.scope === composerScopeIdentity(input.view.scope)
      ) {
        return;
      }
      if (timeout !== null) clearTimeout(timeout);
      timeout = setTimeout(notify, debounceMs);
    },
    dispose() {
      if (timeout !== null) clearTimeout(timeout);
      timeout = null;
      latest = null;
    },
  };
}
