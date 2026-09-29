import { z } from "zod";
import {
  removeComposerMentions,
  setComposerText,
} from "./composer-draft-transforms.js";
export { reconcileComposerMentions } from "./composer-draft-transforms.js";
import type {
  ExperimentalComposerCommand,
  ComposerDraft,
  ComposerDraftReplacement,
  ComposerDraftSnapshot,
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
import { createComposerDraftActions } from "./composer-draft-actions.js";

export { createComposerDraftActions } from "./composer-draft-actions.js";

export interface ComposerEditorState {
  layout: "expanded" | "compact";
  isRunning: boolean;
  isSubmitting: boolean;
  isSubmittingBlocked: boolean;
  submittingBlockedReason: string | null;
  isAttaching: boolean;
  attachmentError: string | null;
}

export interface ComposerHandleTarget {
  key: string;
  scope: PluginComposerScope;
  getDraft(): ComposerDraftSnapshot;
  getAttachmentCount(): number;
  getSelection(): ComposerSelection | null;
  setDraft(next: ComposerDraftReplacement): void;
  addQuote(text: string): void;
  getEditorState(): ComposerEditorState;
  subscribeEditorState(listener: () => void): () => void;
  applyCommand?(command: ExperimentalComposerCommand): boolean;
  insertAtCursor(value: ComposerDraft, block: boolean): boolean;
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
  target: ComposerHandleTarget;
  mentionText(mention: ComposerMention): string;
  setTextEffect(effect: PluginComposerTextEffect | null): void;
  setInputLock(locked: boolean): void;
  onSubmitted(listener: () => void): () => void;
}

export interface ComposerHandleBinding {
  key: string;
  handle: PluginComposerApi;
  update(controller: ComposerHandleController): void;
}

const composerCommandSchema = z.object({
  trigger: z.enum(["/", "$"]),
  name: z
    .string()
    .min(1)
    .regex(/^[^\s/$]+$/u),
  trailingText: z.string().regex(/^\s*$/u),
});

const UNAVAILABLE_MESSAGE = "This composer is no longer available.";
const OFF_SCREEN_MESSAGE = "This composer isn't on screen.";

export const OFF_SCREEN_EDITOR_STATE: ComposerEditorState = {
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

export function appendComposerDraft(
  current: ComposerDraft,
  value: ComposerDraft,
  block: boolean,
): ComposerDraft {
  const base = block ? current.text.replace(/\s+$/u, "") : current.text;
  const separator = block && base.length > 0 ? "\n\n" : "";
  const offset = base.length + separator.length;
  return {
    text: `${base}${separator}${value.text}`,
    mentions: [
      ...current.mentions.filter((mention) => mention.to <= base.length),
      ...value.mentions.map((mention) => ({
        ...mention,
        from: mention.from + offset,
        to: mention.to + offset,
      })),
    ],
  };
}

function validProviderId(provider: string): string | null {
  const trimmed = provider.trim();
  return trimmed.length === 0 || trimmed.includes(":") ? null : trimmed;
}

function insertValue(
  parts: ComposerInsertPart | readonly ComposerInsertPart[],
  controller: ComposerHandleController,
): ComposerDraft {
  const list: readonly ComposerInsertPart[] = Array.isArray(parts)
    ? parts
    : [parts as ComposerInsertPart];
  let text = "";
  const mentions: ComposerMention[] = [];
  for (const part of list) {
    if (typeof part === "string") {
      text += part;
      continue;
    }
    let mention: ComposerMention;
    if ("kind" in part) {
      mention = part;
    } else {
      const provider = validProviderId(part.provider);
      if (provider === null) {
        throw new Error(`Invalid mention provider id "${part.provider}".`);
      }
      mention = {
        from: 0,
        to: 0,
        label: part.label.trim() || part.id,
        kind: "plugin",
        pluginId: controller.pluginId,
        provider,
        id: part.id,
        icon: null,
      };
    }
    const serialized = controller.mentionText(mention);
    mentions.push({
      ...mention,
      from: text.length,
      to: text.length + serialized.length,
    });
    text += serialized;
  }
  return { text, mentions };
}

function isDraftEmpty(draft: ComposerDraft, attachmentCount: number): boolean {
  return (
    draft.text.trim().length === 0 &&
    draft.mentions.length === 0 &&
    attachmentCount === 0
  );
}

const legacyDrafts = new WeakMap<
  ComposerDraftSnapshot,
  ComposerDraftSnapshot
>();

function withLegacyDraftFields(
  draft: ComposerDraftSnapshot,
  attachmentCount: number,
): ComposerDraftSnapshot {
  const cached = legacyDrafts.get(draft);
  if (cached) return cached;
  const snapshot = { ...draft };
  Object.defineProperties(snapshot, {
    isEmpty: { value: isDraftEmpty(draft, attachmentCount), enumerable: false },
    attachmentCount: { value: attachmentCount, enumerable: false },
  });
  Object.freeze(snapshot);
  legacyDrafts.set(draft, snapshot);
  return snapshot;
}

function waitForUploads(target: ComposerHandleTarget): Promise<void> {
  return new Promise((resolve) => {
    if (!target.getEditorState().isAttaching) {
      resolve();
      return;
    }
    const unsubscribe = target.subscribeEditorState(() => {
      if (target.getEditorState().isAttaching) return;
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
  const editorState = () => target().getEditorState();

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

  const replaceText = (nextText: string) => {
    const current = target().getDraft();
    if (nextText === current.text) return;
    target().setDraft(setComposerText(current, nextText));
  };
  const insertMention = (mention: PluginComposerMention) => {
    warnDeprecatedComposerMember("insertMention", "insert");
    const provider = validProviderId(mention.provider);
    if (provider === null) {
      console.warn(
        `[plugin:${controller.pluginId}] useComposer().insertMention: invalid provider id "${mention.provider}"`,
      );
      return;
    }
    if (!legacyAvailable("insertMention")) return;
    const label = mention.label.trim() || mention.id;
    const current = target().getDraft();
    const separator =
      current.text.length === 0 || /\s$/u.test(current.text) ? "" : " ";
    const from = current.text.length + separator.length;
    target().setDraft({
      text: `${current.text}${separator}${label} `,
      mentions: [
        ...current.mentions,
        {
          from,
          to: from + label.length,
          label,
          kind: "plugin",
          pluginId: controller.pluginId,
          provider,
          id: mention.id,
          icon: null,
        },
      ],
    });
    target().focus();
  };
  const removeMentionFrom = (mention: { provider: string; id: string }) => {
    const current = target().getDraft();
    const next = removeComposerMentions(
      current,
      (item) =>
        item.kind === "plugin" &&
        item.pluginId === controller.pluginId &&
        item.provider === mention.provider &&
        item.id === mention.id,
    );
    if (next !== current) target().setDraft(next);
  };
  const removeMention = (mention: { provider: string; id: string }) => {
    warnDeprecatedComposerMember("removeMention", "replace");
    requireAvailable();
    removeMentionFrom(mention);
  };
  const insert = (
    parts: ComposerInsertPart | readonly ComposerInsertPart[],
    options: ComposerInsertOptions = {},
  ) => {
    requireAvailable();
    const value = insertValue(parts, controller);
    const block = options.block === true;
    if ((options.at ?? "cursor") === "cursor") {
      if (!target().insertAtCursor(value, block)) {
        throw new Error(OFF_SCREEN_MESSAGE);
      }
      return;
    }
    target().setDraft(appendComposerDraft(target().getDraft(), value, block));
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
    const errorBefore = editorState().attachmentError;
    await waitForUploads(target());
    const state = editorState();
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
    return hostSetSelection(selection);
  };
  const submittedListeners = new Set<() => void>();
  let submittedSubscription: {
    scope: string;
    unsubscribe: () => void;
  } | null = null;
  const syncSubmittedSubscription = () => {
    const scope =
      submittedListeners.size === 0 ? null : JSON.stringify(target().scope);
    if (submittedSubscription?.scope === scope) return;
    submittedSubscription?.unsubscribe();
    submittedSubscription =
      scope === null
        ? null
        : {
            scope,
            unsubscribe: controller.onSubmitted(() => {
              for (const listener of [...submittedListeners]) {
                try {
                  listener();
                } catch (error) {
                  console.error("Composer submission listener failed", error);
                }
              }
            }),
          };
  };
  const onSubmitted = (listener: () => void) => {
    const entry = () => listener();
    submittedListeners.add(entry);
    syncSubmittedSubscription();
    return () => {
      submittedListeners.delete(entry);
      syncSubmittedSubscription();
    };
  };

  const draftActions = createComposerDraftActions(target);
  const handle: PluginComposerApi = {
    replace: draftActions.replace,
    get scope() {
      return target().scope;
    },
    get key() {
      return target().key;
    },
    get layout() {
      return editorState().layout;
    },
    get isRunning() {
      return editorState().isRunning;
    },
    get isSubmitting() {
      return editorState().isSubmitting;
    },
    get isSubmittingBlocked() {
      return editorState().isSubmittingBlocked;
    },
    get submittingBlockedReason() {
      return editorState().submittingBlockedReason;
    },
    get isEmpty() {
      return isDraftEmpty(target().getDraft(), target().getAttachmentCount());
    },
    get attachmentCount() {
      return target().getAttachmentCount();
    },
    get text() {
      return target().getDraft().text;
    },
    get draft() {
      return withLegacyDraftFields(
        draftActions.draft,
        target().getAttachmentCount(),
      );
    },
    get selection() {
      return target().getSelection();
    },
    setText: (next) => {
      warnDeprecatedComposerMember("setText", "replace");
      if (legacyAvailable("setText")) replaceText(next);
    },
    updateText: (updater) => {
      warnDeprecatedComposerMember("updateText", "replace");
      if (legacyAvailable("updateText")) {
        replaceText(updater(target().getDraft().text));
      }
    },
    clear: () => {
      warnDeprecatedComposerMember("clear", "replace");
      if (legacyAvailable("clear")) replaceText("");
    },
    insert,
    experimental_applyCommand(command) {
      requireAvailable();
      const parsed = composerCommandSchema.safeParse(command);
      if (!parsed.success)
        throw new Error("The composer command is not valid.");
      if (!target().applyCommand?.(parsed.data))
        throw new Error(OFF_SCREEN_MESSAGE);
    },
    setTextEffect: (effect) => controller.setTextEffect(effect),
    setInputLock: (locked) => controller.setInputLock(locked),
    addQuote: (text) => {
      warnDeprecatedComposerMember("addQuote", "replace");
      if (!legacyAvailable("addQuote")) return;
      target().addQuote(text);
      target().focus();
    },
    insertMention,
    removeMention,
    onSubmitted,
    focus: () => target().focus(),
    submit,
    setSelection,
    experimental_removeMention: (mention) => {
      warnDeprecatedComposerMember("experimental_removeMention", "replace");
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
        const state = editorState();
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
      syncSubmittedSubscription();
    },
  };
}
