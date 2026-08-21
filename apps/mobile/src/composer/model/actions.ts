import {
  buildProviderPromptActionProps,
  CREATE_PLUGIN_PROMPT,
  type ProviderPromptActionCommand,
} from "@bb/client-core";
import type {
  PromptMentionCommandTrigger,
  PromptMentionResource,
  ProviderComposerAction,
} from "@bb/domain";
import { type ComposerValue, insertMention, insertText } from "./document";

/**
 * The "+" menu's prompt actions (web `PromptBoxActionsMenu`): provider-owned
 * (skills / plan / goal from `ProviderInfo.composerActions`) plus the
 * app-owned automation and plugin prompts, in a fixed order. Screens can add
 * their own entries (`ComposerAction`) — the thread screen adds context
 * actions — through the same registry shape.
 */

export type ComposerPromptActionKind =
  | "skills"
  | "plan"
  | "goal"
  | "automation"
  | "plugin";

export interface ComposerPromptAction {
  kind: ComposerPromptActionKind;
  /** Text inserted when the action has no command (or the trigger char for skills). */
  text: string;
  command?: ProviderPromptActionCommand;
  label?: string;
  disabled?: boolean;
}

/** A screen-supplied row in the "+" menu. */
export interface ComposerAction {
  key: string;
  label: string;
  icon?:
    | "Zap"
    | "ListTodo"
    | "Target"
    | "Repeat"
    | "ElectricPlugs"
    | "Paperclip"
    | "Fork"
    | "MessageSquarePlus"
    | "GitBranch"
    | "FolderOpen"
    | "PanelBottom"
    | "Sent";
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

const AUTOMATION_PROMPT_ACTION: ComposerPromptAction = {
  kind: "automation",
  command: { trigger: "/", name: "automation", trailingText: " " },
  text: "/automation ",
};

const CREATE_PLUGIN_PROMPT_ACTION: ComposerPromptAction = {
  kind: "plugin",
  text: CREATE_PLUGIN_PROMPT,
};

const APP_PROMPT_ACTIONS: readonly ComposerPromptAction[] = [
  AUTOMATION_PROMPT_ACTION,
  CREATE_PLUGIN_PROMPT_ACTION,
];

const PROMPT_ACTION_ORDER: readonly ComposerPromptActionKind[] = [
  "skills",
  "plan",
  "goal",
  "automation",
  "plugin",
];

export const PROMPT_ACTION_PRESENTATION: Record<
  ComposerPromptActionKind,
  { label: string; icon: NonNullable<ComposerAction["icon"]> }
> = {
  skills: { label: "Skills", icon: "Zap" },
  plan: { label: "Plan", icon: "ListTodo" },
  goal: { label: "Goal", icon: "Target" },
  automation: { label: "Automation", icon: "Repeat" },
  plugin: { label: "Plugin", icon: "ElectricPlugs" },
};

/** Append the app-owned actions the provider did not already supply. */
function withAppPromptActions(
  actions: readonly ComposerPromptAction[],
): ComposerPromptAction[] {
  return [
    ...actions,
    ...APP_PROMPT_ACTIONS.filter(
      (appAction) => !actions.some((action) => action.kind === appAction.kind),
    ),
  ];
}

function orderPromptActions(
  actions: readonly ComposerPromptAction[],
): ComposerPromptAction[] {
  return PROMPT_ACTION_ORDER.flatMap((kind) => {
    const action = actions.find((candidate) => candidate.kind === kind);
    return action && action.text.length > 0 ? [action] : [];
  });
}

/**
 * The menu rows for a provider: its composer actions (skills trigger, plan,
 * goal commands) plus the app actions, ordered. Also returns the provider's
 * skills trigger (the `/` the command typeahead listens for).
 */
export function buildComposerPromptActions(
  composerActions: readonly ProviderComposerAction[],
): {
  actions: ComposerPromptAction[];
  skillsTrigger: PromptMentionCommandTrigger | null;
} {
  const props = buildProviderPromptActionProps(composerActions);
  return {
    actions: orderPromptActions(withAppPromptActions(props.promptActions)),
    skillsTrigger: props.skillsTrigger,
  };
}

export interface PromptActionInsertion {
  value: ComposerValue;
  caret: number;
}

/**
 * Apply a "+" action at the caret (web `applyPromptAction`, simplified for a
 * flat text model): a command action becomes a command pill + its trailing
 * text; `skills` inserts the trigger char so the command menu opens; a plain
 * action inserts its text. Each gets a leading space when glued to a word.
 * Re-applying an action whose text sits right before the caret is a no-op.
 */
export function resolvePromptActionInsertion(
  value: ComposerValue,
  caret: number,
  action: ComposerPromptAction,
): PromptActionInsertion | null {
  if (action.text.length === 0) return null;
  const position = Math.max(0, Math.min(caret, value.text.length));
  const before = value.text.slice(0, position);
  const needsSpace = before.length > 0 && !/\s$/u.test(before);
  if (action.kind !== "skills" && action.command) {
    const { trigger, name, trailingText } = action.command;
    const serializedText = `${trigger}${name}`;
    const alreadyThere = value.mentions.some(
      (mention) =>
        mention.end === position &&
        mention.resource.kind === "command" &&
        mention.resource.name === name &&
        mention.resource.trigger === trigger,
    );
    if (alreadyThere) return null;
    const resource: PromptMentionResource = {
      kind: "command",
      trigger,
      name,
      source: "command",
      origin: "user",
      label: name,
      argumentHint: null,
    };
    const withSpace = needsSpace ? insertText(value, position, " ") : value;
    const from = needsSpace ? position + 1 : position;
    return insertMention(withSpace, {
      from,
      to: from,
      displayText: serializedText,
      serializedText,
      resource,
      trailingText,
    });
  }
  if (before.endsWith(action.text)) return null;
  const inserted = `${needsSpace ? " " : ""}${action.text}`;
  return {
    value: insertText(value, position, inserted),
    caret: position + inserted.length,
  };
}
