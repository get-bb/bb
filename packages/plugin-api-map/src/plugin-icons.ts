import ArrowDataTransferHorizontalIcon from "@hugeicons/core-free-icons/ArrowDataTransferHorizontalIcon";
import Clock01Icon from "@hugeicons/core-free-icons/Clock01Icon";
import ComputerIcon from "@hugeicons/core-free-icons/ComputerIcon";
import DatabaseIcon from "@hugeicons/core-free-icons/DatabaseIcon";
import Layers01Icon from "@hugeicons/core-free-icons/Layers01Icon";
import SourceCodeIcon from "@hugeicons/core-free-icons/SourceCodeIcon";
import SparklesIcon from "@hugeicons/core-free-icons/SparklesIcon";
import ComputerTerminal01Icon from "@hugeicons/core-free-icons/ComputerTerminal01Icon";
import TestTubeIcon from "@hugeicons/core-free-icons/TestTubeIcon";
import Activity03Icon from "@hugeicons/core-free-icons/Activity03Icon";
import type { IconSvgElement } from "@hugeicons/react";
import type { IconName } from "@bb/shared-ui/icon";
import accountPoolManifest from "../../../plugins/account-pool/package.json";
import askUserQuestionManifest from "../../../plugins/ask-user-question/package.json";
import automationsManifest from "../../../plugins/automations/package.json";
import browserAutomationManifest from "../../../plugins/browser-automation/package.json";
import concurrencyLimitManifest from "../../../plugins/concurrency-limit/package.json";
import customInstructionsManifest from "../../../plugins/custom-instructions/package.json";
import docsManifest from "../../../plugins/docs/package.json";
import draftsManifest from "../../../plugins/drafts/package.json";
import monacoEditorManifest from "../../../plugins/monaco-editor/package.json";
import githubManifest from "../../../plugins/github/package.json";
import inlineVisManifest from "../../../plugins/inline-vis/package.json";
import keepAwakeManifest from "../../../plugins/keep-awake/package.json";
import memoryManifest from "../../../plugins/memory/package.json";
import environmentModalSandboxManifest from "../../../plugins/environment-modal-sandbox/package.json";
import environmentPersonalWorkspaceManifest from "../../../plugins/environment-personal-workspace/package.json";
import environmentProjectCheckoutManifest from "../../../plugins/environment-project-checkout/package.json";
import providerUsageManifest from "../../../plugins/provider-usage/package.json";
import providerRetryManifest from "../../../plugins/provider-retry/package.json";
import pushNotificationsManifest from "../../../plugins/push-notifications/package.json";
import connectManifest from "../../../plugins/connect/package.json";
import secretsManifest from "../../../plugins/secrets/package.json";
import scheduledSendManifest from "../../../plugins/scheduled-send/package.json";
import sideChatManifest from "../../../plugins/side-chat/package.json";
import tasksManifest from "../../../plugins/tasks/package.json";
import workflowsManifest from "../../../plugins/workflows/package.json";
import environmentGitWorktreeManifest from "../../../plugins/environment-git-worktree/package.json";
import providerAcpManifest from "../../../plugins/provider-acp/package.json";
import providerClaudeCodeManifest from "../../../plugins/provider-claude-code/package.json";
import providerCodexManifest from "../../../plugins/provider-codex/package.json";
import providerPiManifest from "../../../plugins/provider-pi/package.json";

const FIRST_PARTY_PLUGINS = [
  accountPoolManifest,
  askUserQuestionManifest,
  automationsManifest,
  browserAutomationManifest,
  concurrencyLimitManifest,
  customInstructionsManifest,
  docsManifest,
  draftsManifest,
  monacoEditorManifest,
  githubManifest,
  inlineVisManifest,
  keepAwakeManifest,
  memoryManifest,
  environmentModalSandboxManifest,
  environmentPersonalWorkspaceManifest,
  environmentProjectCheckoutManifest,
  providerUsageManifest,
  providerRetryManifest,
  pushNotificationsManifest,
  connectManifest,
  secretsManifest,
  scheduledSendManifest,
  sideChatManifest,
  tasksManifest,
  workflowsManifest,
  environmentGitWorktreeManifest,
  providerAcpManifest,
  providerClaudeCodeManifest,
  providerCodexManifest,
  providerPiManifest,
];

export function pluginIcon(displayName: string): IconName | null {
  const icon = FIRST_PARTY_PLUGINS.find(
    (plugin) => plugin.bb.name === displayName,
  )?.bb.branding.icon;
  return icon && !icon.startsWith("./") ? icon : null;
}

export function firstPartyPluginId(displayName: string): string | null {
  const plugin = FIRST_PARTY_PLUGINS.find(
    (plugin) => plugin.bb.name === displayName,
  );
  return plugin?.name.replace(/^bb-plugin-/, "") ?? null;
}

const SURFACE_ICONS: Record<string, IconSvgElement> = {
  cli: ComputerTerminal01Icon,
  "agent-tools": SparklesIcon,
  background: Clock01Icon,
  wire: ArrowDataTransferHorizontalIcon,
  storage: DatabaseIcon,
  "thread-events": Activity03Icon,
  "host-workers": ComputerIcon,
  "bb-sdk": SourceCodeIcon,
  "host-components": Layers01Icon,
  testing: TestTubeIcon,
};

export function surfaceIcon(surfaceId: string): IconSvgElement | null {
  return SURFACE_ICONS[surfaceId] ?? null;
}
