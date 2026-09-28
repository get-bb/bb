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
  getDraft(): ComposerDraft;
  getAttachmentCount(): number;
  setDraft(next: ComposerDraft): void;
  addQuote(text: string): void;
  getEditorState(): ComposerEditorState;
  subscribeEditorState(listener: () => void): () => void;
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

export function reconcileComposerMentions(
  currentText: string,
  nextText: string,
  mentions: readonly ComposerMention[],
): ComposerMention[] {
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
    if (mention.to <= unchangedPrefixLength) return [mention];
    if (mention.from >= replacedCurrentEnd) {
      return [
        {
          ...mention,
          from: mention.from + replacementDelta,
          to: mention.to + replacementDelta,
        },
      ];
    }
    return [];
  });
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

function withoutOwnMention(
  draft: ComposerDraft,
  pluginId: string,
  provider: string,
  id: string,
): ComposerDraft {
  let next = draft;
  const matches = draft.mentions
    .filter(
      (mention) =>
        mention.kind === "plugin" &&
        mention.pluginId === pluginId &&
        mention.provider === provider &&
        mention.id === id,
    )
    .sort((a, b) => b.from - a.from);
  for (const match of matches) {
    const length = match.to - match.from;
    next = {
      text: next.text.slice(0, match.from) + next.text.slice(match.to),
      mentions: next.mentions
        .filter((mention) => mention !== match)
        .map((mention) =>
          mention.from >= match.to
            ? {
                ...mention,
                from: mention.from - length,
                to: mention.to - length,
              }
            : mention,
        ),
    };
  }
  return next;
}

function isDraftEmpty(draft: ComposerDraft, attachmentCount: number): boolean {
  return (
    draft.text.trim().length === 0 &&
    draft.mentions.length === 0 &&
    attachmentCount === 0
  );
}

const legacyDrafts = new WeakSet<ComposerDraft>();

function withLegacyDraftFields(
  draft: ComposerDraft,
  attachmentCount: number,
): ComposerDraft {
  if (legacyDrafts.has(draft)) return draft;
  Object.defineProperties(draft, {
    isEmpty: { value: isDraftEmpty(draft, attachmentCount), enumerable: false },
    attachmentCount: { value: attachmentCount, enumerable: false },
  });
  legacyDrafts.add(draft);
  return draft;
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
    target().setDraft({
      text: nextText,
      mentions: reconcileComposerMentions(
        current.text,
        nextText,
        current.mentions,
      ),
    });
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
    const next = withoutOwnMention(
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
        target().getDraft(),
        target().getAttachmentCount(),
      );
    },
    setText: (next) => {
      if (legacyAvailable("setText")) replaceText(next);
    },
    updateText: (updater) => {
      if (legacyAvailable("updateText")) {
        replaceText(updater(target().getDraft().text));
      }
    },
    clear: () => {
      if (legacyAvailable("clear")) replaceText("");
    },
    insert,
    setTextEffect: (effect) => controller.setTextEffect(effect),
    setInputLock: (locked) => controller.setInputLock(locked),
    addQuote: (text) => {
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
    },
  };
}
