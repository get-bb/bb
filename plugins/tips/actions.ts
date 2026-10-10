import type {
  ComposerDraftReplacement,
  ComposerDraftSnapshot,
} from "@get-bb/plugin-sdk/app";
import { composeTipDraft } from "./compose.js";
import type { TipAction, TipView } from "./contract.js";

export interface TipActionHost {
  replaceDraft(
    update: (
      current: ComposerDraftSnapshot,
    ) => ComposerDraftReplacement | ComposerDraftSnapshot,
  ): void;
  focusComposer(): void;
  openAppRoute(path: string): boolean;
  runAppCommand(commandId: string): boolean;
  openUrl(url: string): boolean;
}

export interface TipActionResult {
  ok: boolean;
  announcement: string;
}

export function pluginDetailPath(pluginId: string): string {
  return `/plugins/${encodeURIComponent(pluginId)}`;
}

function attempt(ok: boolean, done: string, label: string): TipActionResult {
  return {
    ok,
    announcement: ok ? done : `Couldn't open ${label} here.`,
  };
}

export function describeTipAction(action: TipAction): string {
  switch (action.kind) {
    case "prompt":
      return "Adds prompt to composer";
    case "open-page":
      return `Opens ${action.label}`;
    case "run-command":
      return action.label;
    case "open-plugin":
      return `Opens ${action.label}`;
    case "learn-more":
      return `Opens ${action.label} in the browser`;
  }
}

export function runTipAction(
  tip: TipView,
  host: TipActionHost,
): TipActionResult {
  const action = tip.action;
  switch (action.kind) {
    case "prompt":
      host.replaceDraft((current) => composeTipDraft(action.prompt, current));
      host.focusComposer();
      return { ok: true, announcement: `Added “${tip.title}” to the composer` };
    case "open-page":
      return attempt(
        host.openAppRoute(action.path),
        `Opened ${action.label}`,
        action.label,
      );
    case "run-command":
      return attempt(
        host.runAppCommand(action.commandId),
        `Opened ${action.label}`,
        action.label,
      );
    case "open-plugin":
      return attempt(
        host.openAppRoute(pluginDetailPath(action.pluginId)),
        `Opened ${action.label}`,
        action.label,
      );
    case "learn-more":
      return attempt(
        host.openUrl(action.url),
        `Opened ${action.label}`,
        action.label,
      );
  }
}
