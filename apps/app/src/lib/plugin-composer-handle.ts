import { z } from "zod";
import type {
  ComposerDraft,
  ComposerMention,
  ComposerSelection,
  PluginComposerApi,
} from "@get-bb/plugin-sdk";
import {
  appendComposerDraft,
  createComposerHandleBinding,
  OFF_SCREEN_EDITOR_STATE,
  type ComposerHandleBinding,
  type ComposerHandleController,
  type ComposerHandleTarget,
} from "@get-bb/plugin-sdk/internal/composer-handle";
import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import {
  permissionModeSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "@bb/domain";
import { createThreadEnvironmentArgsSchema } from "@bb/server-contract";
import {
  appendQuoteAndAttachmentsToDraft,
  type PromptDraftState,
} from "@bb/client-core";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { serializedTextForPromptMentionResource } from "@/components/promptbox/mentions/prompt-mention-clipboard";
import { subscribeComposerSubmitted } from "./composer-submissions";
import {
  getComposerEditorBridge,
  subscribeComposerEditorBridge,
} from "./composer-editor-registry";

export type ComposerSource = Pick<
  PluginComposerHost,
  | "scope"
  | "textEffectKey"
  | "getCurrent"
  | "setDraft"
  | "isAvailable"
  | "focus"
  | "submit"
  | "setSelection"
>;

type ComposerLifecycle = Pick<
  ComposerHandleController,
  "setTextEffect" | "setInputLock" | "onSubmitted"
>;

const composerSelectionSchema = z.object({
  projectId: z.string().min(1).optional(),
  environment: createThreadEnvironmentArgsSchema.optional(),
  providerId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  serviceTier: serviceTierSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
});

const COMPOSER_SELECTION_FIELD_LABELS: Record<keyof ComposerSelection, string> =
  {
    projectId: "project",
    environment: "environment",
    providerId: "provider",
    model: "model",
    reasoningLevel: "reasoning level",
    serviceTier: "service tier",
    permissionMode: "permission mode",
  };

export function parseComposerSelection(selection: unknown): ComposerSelection {
  const parsed = composerSelectionSchema.safeParse(selection);
  if (parsed.success) {
    return Object.fromEntries(
      Object.entries(parsed.data).filter(([, value]) => value !== undefined),
    ) as ComposerSelection;
  }
  const field = parsed.error.issues[0]?.path[0];
  const label =
    typeof field === "string" && field in COMPOSER_SELECTION_FIELD_LABELS
      ? COMPOSER_SELECTION_FIELD_LABELS[field as keyof ComposerSelection]
      : null;
  throw new Error(
    label === null
      ? "The selection is not valid."
      : `The selection's ${label} is not valid.`,
  );
}

function splitPluginItemId(
  pluginId: string,
  itemId: string,
): { provider: string; id: string } {
  const separator = itemId.indexOf(":");
  return separator === -1
    ? { provider: pluginId, id: itemId }
    : { provider: itemId.slice(0, separator), id: itemId.slice(separator + 1) };
}

export function composerMentionFromTextMention({
  start,
  end,
  resource,
}: PromptTextMention): ComposerMention {
  if (resource.kind !== "plugin") return { from: start, to: end, ...resource };
  const { itemId, ...plugin } = resource;
  return {
    from: start,
    to: end,
    ...plugin,
    ...splitPluginItemId(resource.pluginId, itemId),
  };
}

function textMentionFromComposerMention(
  mention: ComposerMention,
): PromptTextMention {
  return {
    start: mention.from,
    end: mention.to,
    resource: resourceOf(mention),
  };
}

function resourceOf(mention: ComposerMention): PromptMentionResource {
  if (mention.kind === "plugin") {
    const { from: _from, to: _to, provider, id, ...plugin } = mention;
    return { ...plugin, itemId: `${provider}:${id}` };
  }
  const { from: _from, to: _to, ...resource } = mention;
  return resource;
}

function mentionText(mention: ComposerMention): string {
  return serializedTextForPromptMentionResource(resourceOf(mention));
}

const composerDrafts = new WeakMap<PromptDraftState, ComposerDraft>();

function composerDraftOf(draft: PromptDraftState): ComposerDraft {
  const cached = composerDrafts.get(draft);
  if (cached !== undefined) return cached;
  const next: ComposerDraft = {
    text: draft.text,
    mentions: draft.mentions.map(composerMentionFromTextMention),
  };
  composerDrafts.set(draft, next);
  return next;
}

function composerHandleTarget(source: ComposerSource): ComposerHandleTarget {
  const setDraft = (next: ComposerDraft) =>
    source.setDraft({
      ...source.getCurrent(),
      text: next.text,
      mentions: next.mentions.map(textMentionFromComposerMention),
    });
  const getDraft = () => composerDraftOf(source.getCurrent());
  const hostSetSelection = source.setSelection;
  const key = source.textEffectKey;
  return {
    key,
    scope: source.scope,
    getDraft,
    getAttachmentCount: () => source.getCurrent().attachments.length,
    setDraft,
    addQuote: (text) => {
      const current = source.getCurrent();
      const next = appendQuoteAndAttachmentsToDraft(current, text, []);
      if (next !== current) source.setDraft(next);
    },
    getEditorState: () =>
      getComposerEditorBridge(key)?.state ?? OFF_SCREEN_EDITOR_STATE,
    subscribeEditorState: (listener) =>
      subscribeComposerEditorBridge(key, listener),
    insertAtCursor: (value, block) => {
      const bridge = getComposerEditorBridge(key);
      if (bridge === null) return false;
      const inserted = bridge.insertAtCursor(
        {
          text: value.text,
          mentions: value.mentions.map(textMentionFromComposerMention),
        },
        block,
      );
      if (!inserted) setDraft(appendComposerDraft(getDraft(), value, block));
      return true;
    },
    isAvailable: source.isAvailable ?? (() => true),
    focus: source.focus,
    ...(source.submit !== undefined ? { submit: source.submit } : {}),
    ...(hostSetSelection !== undefined
      ? {
          setSelection: (selection: ComposerSelection) =>
            hostSetSelection(parseComposerSelection(selection)),
        }
      : {}),
  };
}

export function composerHandleController(
  pluginId: string,
  source: ComposerSource,
  lifecycle: ComposerLifecycle,
): ComposerHandleController {
  return {
    pluginId,
    target: composerHandleTarget(source),
    mentionText,
    ...lifecycle,
  };
}

export function detachedComposerController(
  pluginId: string,
  host: PluginComposerHost,
  caller: string,
): ComposerHandleController {
  const scope = host.scope;
  const warnNoLifecycle = (method: string) => {
    console.warn(
      `[plugin:${pluginId}] ${caller} composer.${method} has no effect; call it from a composer slot's useComposer().`,
    );
  };
  return composerHandleController(pluginId, host, {
    setTextEffect: () => warnNoLifecycle("setTextEffect"),
    setInputLock: () => warnNoLifecycle("setInputLock"),
    onSubmitted: (listener) => subscribeComposerSubmitted(scope, listener),
  });
}

const listedComposerBindings = new Map<
  string,
  Map<string, ComposerHandleBinding>
>();

export function listedComposerHandles(
  pluginId: string,
  hosts: readonly PluginComposerHost[],
): readonly PluginComposerApi[] {
  const previous = listedComposerBindings.get(pluginId) ?? new Map();
  const next = new Map<string, ComposerHandleBinding>();
  const handles = hosts.map((host) => {
    const controller = detachedComposerController(
      pluginId,
      host,
      "useComposers()",
    );
    const existing = previous.get(host.textEffectKey);
    const binding =
      existing ?? createComposerHandleBinding(host.textEffectKey, controller);
    binding.update(controller);
    next.set(host.textEffectKey, binding);
    return binding.handle;
  });
  if (next.size === 0) listedComposerBindings.delete(pluginId);
  else listedComposerBindings.set(pluginId, next);
  return handles;
}
