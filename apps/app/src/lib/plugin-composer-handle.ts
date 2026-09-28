import { z } from "zod";
import type {
  ComposerDraft,
  ComposerInsertOptions,
  ComposerInsertPart,
  ComposerMention,
  ComposerSelection,
  ComposerSubmitOptions,
  JsonValue,
  PluginComposerApi,
  PluginComposerMention,
  PluginComposerScope,
  PluginComposerTextEffect,
} from "@get-bb/plugin-sdk";
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
import { serializedTextForPromptMentionResource } from "@/components/promptbox/mentions/prompt-mention-clipboard";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import {
  removePluginMention,
  subscribeComposerSubmitted,
} from "./composer-submissions";
import {
  getComposerEditorBridge,
  subscribeComposerEditorBridge,
  type ComposerEditorState,
  type ComposerEditorInsertValue,
} from "./composer-editor-registry";

export interface ComposerTarget {
  key: string;
  scope: PluginComposerScope;
  getCurrent(): PromptDraftState;
  setDraft(next: PromptDraftState): void;
  isAvailable(): boolean;
  focus(): void;
  submit?(
    options: ComposerSubmitOptions,
    pluginSubmission: { pluginId: string; data: JsonValue } | undefined,
  ): Promise<void>;
  setSelection?(selection: ComposerSelection): Promise<ComposerSelection>;
}

export interface ComposerHandleController {
  pluginId: string;
  target: ComposerTarget;
  setTextEffect(effect: PluginComposerTextEffect | null): void;
  setInputLock(locked: boolean): void;
  onSubmitted(listener: () => void): () => void;
}

export interface ComposerHandleBinding {
  key: string;
  handle: PluginComposerApi;
  update(controller: ComposerHandleController): void;
}

const UNAVAILABLE_MESSAGE = "This composer is no longer available.";
const OFF_SCREEN_MESSAGE = "This composer isn't on screen.";

const OFF_SCREEN_EDITOR_STATE: ComposerEditorState = {
  layout: "expanded",
  isRunning: false,
  isSubmitting: false,
  isSubmittingBlocked: true,
  submittingBlockedReason: OFF_SCREEN_MESSAGE,
  isAttaching: false,
  attachmentError: null,
};

const warnedAliases = new Set<string>();

function warnDeprecatedComposerMember(oldName: string, newName: string): void {
  if (warnedAliases.has(oldName)) return;
  warnedAliases.add(oldName);
  console.warn(
    `useComposer().${oldName} is deprecated; use useComposer().${newName}.`,
  );
}

export function reconcileComposerMentions(
  currentText: string,
  nextText: string,
  mentions: readonly PromptTextMention[],
): PromptTextMention[] {
  if (currentText === nextText) return [...mentions];

  let unchangedPrefixLength = 0;
  const maximumPrefixLength = Math.min(currentText.length, nextText.length);
  while (
    unchangedPrefixLength < maximumPrefixLength &&
    currentText[unchangedPrefixLength] === nextText[unchangedPrefixLength]
  ) {
    unchangedPrefixLength += 1;
  }

  let unchangedSuffixLength = 0;
  while (
    unchangedSuffixLength < currentText.length - unchangedPrefixLength &&
    unchangedSuffixLength < nextText.length - unchangedPrefixLength &&
    currentText[currentText.length - unchangedSuffixLength - 1] ===
      nextText[nextText.length - unchangedSuffixLength - 1]
  ) {
    unchangedSuffixLength += 1;
  }

  const replacedCurrentEnd = currentText.length - unchangedSuffixLength;
  const replacementDelta = nextText.length - currentText.length;
  return mentions.flatMap((mention) => {
    if (mention.end <= unchangedPrefixLength) return [mention];
    if (mention.start >= replacedCurrentEnd) {
      return [
        {
          ...mention,
          start: mention.start + replacementDelta,
          end: mention.end + replacementDelta,
        },
      ];
    }
    return [];
  });
}

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
  resource: Extract<PromptMentionResource, { kind: "plugin" }>,
): { provider: string; id: string } {
  const separator = resource.itemId.indexOf(":");
  return separator === -1
    ? { provider: resource.pluginId, id: resource.itemId }
    : {
        provider: resource.itemId.slice(0, separator),
        id: resource.itemId.slice(separator + 1),
      };
}

export function composerMentionFromTextMention(
  mention: PromptTextMention,
): ComposerMention {
  const range = { from: mention.start, to: mention.end };
  const { resource } = mention;
  switch (resource.kind) {
    case "thread":
      return {
        ...range,
        label: resource.label,
        kind: "thread",
        threadId: resource.threadId,
        ...(resource.projectId !== undefined
          ? { projectId: resource.projectId }
          : {}),
      };
    case "project":
      return {
        ...range,
        label: resource.label,
        kind: "project",
        projectId: resource.projectId,
      };
    case "section":
      return {
        ...range,
        label: resource.label,
        kind: "section",
        sectionId: resource.sectionId,
      };
    case "path":
      return {
        ...range,
        label: resource.label,
        kind: "path",
        path: resource.path,
        source: resource.source,
        entryKind: resource.entryKind,
      };
    case "command":
      return {
        ...range,
        label: resource.label,
        kind: "command",
        trigger: resource.trigger,
        name: resource.name,
        source: resource.source,
        origin: resource.origin,
        argumentHint: resource.argumentHint,
      };
    case "plugin":
      return {
        ...range,
        label: resource.label,
        kind: "plugin",
        pluginId: resource.pluginId,
        ...splitPluginItemId(resource),
        ...(resource.icon !== undefined ? { icon: resource.icon } : {}),
      };
  }
}

function resourceFromComposerMention(
  mention: ComposerMention,
): PromptMentionResource {
  switch (mention.kind) {
    case "thread":
      return {
        kind: "thread",
        threadId: mention.threadId,
        ...(mention.projectId !== undefined
          ? { projectId: mention.projectId }
          : {}),
        label: mention.label,
      };
    case "project":
      return {
        kind: "project",
        projectId: mention.projectId,
        label: mention.label,
      };
    case "section":
      return {
        kind: "section",
        sectionId: mention.sectionId,
        label: mention.label,
      };
    case "path":
      return {
        kind: "path",
        source: mention.source,
        entryKind: mention.entryKind,
        path: mention.path,
        label: mention.label,
      };
    case "command":
      return {
        kind: "command",
        trigger: mention.trigger,
        name: mention.name,
        source: mention.source,
        origin: mention.origin,
        label: mention.label,
        argumentHint: mention.argumentHint,
      };
    case "plugin":
      return {
        kind: "plugin",
        pluginId: mention.pluginId,
        icon: mention.icon ?? null,
        itemId: `${mention.provider}:${mention.id}`,
        label: mention.label,
      };
  }
}

function validProviderId(provider: string): string | null {
  const trimmed = provider.trim();
  return trimmed.length === 0 || trimmed.includes(":") ? null : trimmed;
}

function resourceFromInsertPart(
  part: ComposerMention | PluginComposerMention,
  pluginId: string,
): PromptMentionResource {
  if ("kind" in part) return resourceFromComposerMention(part);
  const provider = validProviderId(part.provider);
  if (provider === null) {
    throw new Error(`Invalid mention provider id "${part.provider}".`);
  }
  return {
    kind: "plugin",
    pluginId,
    icon: null,
    itemId: `${provider}:${part.id}`,
    label: part.label.trim() || part.id,
  };
}

export function composerInsertValue(
  parts: ComposerInsertPart | readonly ComposerInsertPart[],
  pluginId: string,
): ComposerEditorInsertValue {
  const list: readonly ComposerInsertPart[] = Array.isArray(parts)
    ? parts
    : [parts as ComposerInsertPart];
  let text = "";
  const mentions: PromptTextMention[] = [];
  for (const part of list) {
    if (typeof part === "string") {
      text += part;
      continue;
    }
    const resource = resourceFromInsertPart(part, pluginId);
    const serialized = serializedTextForPromptMentionResource(resource);
    mentions.push({
      start: text.length,
      end: text.length + serialized.length,
      resource,
    });
    text += serialized;
  }
  return { text, mentions };
}

export function appendComposerInsertValue(
  current: PromptDraftState,
  value: ComposerEditorInsertValue,
  block: boolean,
): PromptDraftState {
  const base = block ? current.text.replace(/\s+$/u, "") : current.text;
  const separator = block && base.length > 0 ? "\n\n" : "";
  const offset = base.length + separator.length;
  return {
    ...current,
    text: `${base}${separator}${value.text}`,
    mentions: [
      ...current.mentions.filter((mention) => mention.end <= base.length),
      ...value.mentions.map((mention) => ({
        ...mention,
        start: mention.start + offset,
        end: mention.end + offset,
      })),
    ],
  };
}

function isDraftEmpty(draft: PromptDraftState): boolean {
  return (
    draft.text.trim().length === 0 &&
    draft.mentions.length === 0 &&
    draft.attachments.length === 0
  );
}

const composerDrafts = new WeakMap<PromptDraftState, ComposerDraft>();

function composerDraftOf(draft: PromptDraftState): ComposerDraft {
  const cached = composerDrafts.get(draft);
  if (cached !== undefined) return cached;
  const next: ComposerDraft = {
    text: draft.text,
    mentions: draft.mentions.map(composerMentionFromTextMention),
  };
  Object.defineProperties(next, {
    isEmpty: { value: isDraftEmpty(draft), enumerable: false },
    attachmentCount: { value: draft.attachments.length, enumerable: false },
  });
  composerDrafts.set(draft, next);
  return next;
}

function editorStateOf(key: string): ComposerEditorState {
  return getComposerEditorBridge(key)?.state ?? OFF_SCREEN_EDITOR_STATE;
}

function waitForUploads(key: string): Promise<void> {
  return new Promise((resolve) => {
    const settled = () => {
      const bridge = getComposerEditorBridge(key);
      return bridge === null || !bridge.state.isAttaching;
    };
    if (settled()) {
      resolve();
      return;
    }
    const unsubscribe = subscribeComposerEditorBridge(key, () => {
      if (!settled()) return;
      unsubscribe();
      resolve();
    });
  });
}

export function createComposerHandleBinding(
  key: string,
  initial: ComposerHandleController,
): ComposerHandleBinding {
  let controller = initial;
  const target = () => controller.target;

  const requireAvailable = () => {
    if (!target().isAvailable()) throw new Error(UNAVAILABLE_MESSAGE);
  };
  const legacyAvailable = (method: string) => {
    if (target().isAvailable()) return true;
    console.warn(
      `[plugin:${controller.pluginId}] useComposer().${method}: ${UNAVAILABLE_MESSAGE}`,
    );
    return false;
  };

  const replaceText = (current: PromptDraftState, nextText: string) => {
    if (nextText === current.text) return;
    target().setDraft({
      ...current,
      text: nextText,
      mentions: reconcileComposerMentions(
        current.text,
        nextText,
        current.mentions,
      ),
    });
  };

  const setText = (next: string) => {
    if (!legacyAvailable("setText")) return;
    replaceText(target().getCurrent(), next);
  };
  const updateText = (updater: (current: string) => string) => {
    if (!legacyAvailable("updateText")) return;
    const current = target().getCurrent();
    replaceText(current, updater(current.text));
  };
  const clear = () => {
    if (!legacyAvailable("clear")) return;
    replaceText(target().getCurrent(), "");
  };
  const addQuote = (text: string) => {
    if (!legacyAvailable("addQuote")) return;
    const current = target().getCurrent();
    const next = appendQuoteAndAttachmentsToDraft(current, text, []);
    if (next !== current) target().setDraft(next);
    target().focus();
  };
  const insertMention = (mention: PluginComposerMention) => {
    const provider = validProviderId(mention.provider);
    if (provider === null) {
      console.warn(
        `[plugin:${controller.pluginId}] useComposer().insertMention: invalid provider id "${mention.provider}"`,
      );
      return;
    }
    if (!legacyAvailable("insertMention")) return;
    const label = mention.label.trim() || mention.id;
    const current = target().getCurrent();
    const separator =
      current.text.length === 0 || /\s$/u.test(current.text) ? "" : " ";
    const start = current.text.length + separator.length;
    target().setDraft({
      ...current,
      text: `${current.text}${separator}${label} `,
      mentions: [
        ...current.mentions,
        {
          start,
          end: start + label.length,
          resource: {
            kind: "plugin",
            pluginId: controller.pluginId,
            icon: null,
            itemId: `${provider}:${mention.id}`,
            label,
          },
        },
      ],
    });
    target().focus();
  };
  const removeMentionFrom = (mention: { provider: string; id: string }) => {
    const current = target().getCurrent();
    const next = removePluginMention(
      current,
      controller.pluginId,
      mention.provider,
      mention.id,
    );
    if (next !== current) target().setDraft(next);
  };
  const removeMention = (mention: { provider: string; id: string }) => {
    requireAvailable();
    removeMentionFrom(mention);
  };
  const insert = (
    parts: ComposerInsertPart | readonly ComposerInsertPart[],
    options: ComposerInsertOptions = {},
  ) => {
    requireAvailable();
    const value = composerInsertValue(parts, controller.pluginId);
    const block = options.block === true;
    if ((options.at ?? "cursor") === "cursor") {
      const bridge = getComposerEditorBridge(target().key);
      if (bridge === null) throw new Error(OFF_SCREEN_MESSAGE);
      bridge.insertAtCursor(value, block);
      return;
    }
    target().setDraft(
      appendComposerInsertValue(target().getCurrent(), value, block),
    );
  };
  const submit = async (options: ComposerSubmitOptions) => {
    requireAvailable();
    const hostSubmit = target().submit;
    if (hostSubmit === undefined) {
      throw new Error("This composer cannot submit programmatically.");
    }
    if (
      options.sendAt !== undefined &&
      (!Number.isFinite(options.sendAt) || options.sendAt <= Date.now())
    ) {
      throw new Error("Pick a time in the future.");
    }
    const key = target().key;
    const errorBefore = editorStateOf(key).attachmentError;
    await waitForUploads(key);
    const state = editorStateOf(key);
    if (
      state.attachmentError !== null &&
      state.attachmentError !== errorBefore
    ) {
      throw new Error(state.attachmentError);
    }
    if (state.isSubmittingBlocked) {
      throw new Error(
        state.submittingBlockedReason ??
          "This composer can't submit right now.",
      );
    }
    await hostSubmit(
      options,
      options.experimental_data === undefined
        ? undefined
        : { pluginId: controller.pluginId, data: options.experimental_data },
    );
  };
  const setSelection = async (selection: ComposerSelection) => {
    requireAvailable();
    const hostSetSelection = target().setSelection;
    if (hostSetSelection === undefined) {
      throw new Error("This composer has no pickers to set.");
    }
    return hostSetSelection(parseComposerSelection(selection));
  };
  const onSubmitted = (listener: () => void) =>
    controller.onSubmitted(listener);

  const handle: PluginComposerApi = {
    get scope() {
      return target().scope;
    },
    get key() {
      return target().key;
    },
    get layout() {
      return editorStateOf(target().key).layout;
    },
    get isRunning() {
      return editorStateOf(target().key).isRunning;
    },
    get isSubmitting() {
      return editorStateOf(target().key).isSubmitting;
    },
    get isSubmittingBlocked() {
      return editorStateOf(target().key).isSubmittingBlocked;
    },
    get submittingBlockedReason() {
      return editorStateOf(target().key).submittingBlockedReason;
    },
    get isEmpty() {
      return isDraftEmpty(target().getCurrent());
    },
    get attachmentCount() {
      return target().getCurrent().attachments.length;
    },
    get text() {
      return target().getCurrent().text;
    },
    get draft() {
      return composerDraftOf(target().getCurrent());
    },
    setText,
    updateText,
    clear,
    insert,
    setTextEffect: (effect) => controller.setTextEffect(effect),
    setInputLock: (locked) => controller.setInputLock(locked),
    addQuote,
    insertMention,
    removeMention,
    onSubmitted,
    focus: () => target().focus(),
    submit,
    setSelection,
    experimental_removeMention: (mention) => {
      warnDeprecatedComposerMember(
        "experimental_removeMention",
        "removeMention",
      );
      if (!legacyAvailable("experimental_removeMention")) return;
      removeMentionFrom(mention);
    },
    experimental_onSubmitted: (listener) => {
      warnDeprecatedComposerMember("experimental_onSubmitted", "onSubmitted");
      return onSubmitted(listener);
    },
    experimental_submit: (options) => {
      warnDeprecatedComposerMember("experimental_submit", "submit");
      return submit(options);
    },
    experimental_setSelection: (selection) => {
      warnDeprecatedComposerMember("experimental_setSelection", "setSelection");
      return setSelection(selection);
    },
  };
  Object.defineProperties(handle, {
    run: {
      enumerable: false,
      get: () => {
        const state = editorStateOf(target().key);
        return { isRunning: state.isRunning, isSubmitting: state.isSubmitting };
      },
    },
    setThreadRowStatus: { enumerable: false, value: () => {} },
  });

  return {
    key,
    handle,
    update(next) {
      controller = next;
    },
  };
}

const alwaysAvailable = () => true;

export function composerTargetFromHost(
  host: PluginComposerHost,
): ComposerTarget {
  return {
    key: host.textEffectKey,
    scope: host.scope,
    getCurrent: host.getCurrent,
    setDraft: host.setDraft,
    isAvailable: host.isAvailable ?? alwaysAvailable,
    focus: host.focus,
    ...(host.submit !== undefined ? { submit: host.submit } : {}),
    ...(host.setSelection !== undefined
      ? { setSelection: host.setSelection }
      : {}),
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
  return {
    pluginId,
    target: composerTargetFromHost(host),
    setTextEffect: () => warnNoLifecycle("setTextEffect"),
    setInputLock: () => warnNoLifecycle("setInputLock"),
    onSubmitted: (listener) => subscribeComposerSubmitted(scope, listener),
  };
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
