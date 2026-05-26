import {
  appToast,
  AppToastContent,
  type AppToastOptions,
  type AppToastTone,
} from "./app-toast";
import { Button } from "./button";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "Toasts",
};

type ToastTone = AppToastTone;

interface ToastExample {
  id: string;
  group: string;
  label: string;
  source: string;
  usage: readonly string[];
  current: CurrentToast;
}

interface CurrentToast {
  title: string;
  description?: string;
  tone: ToastTone;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
}

interface CurrentToastPreviewProps {
  toast: CurrentToast;
}

interface ToastRowHintProps {
  example: ToastExample;
}

interface ToastUsageHintProps {
  usage: readonly string[];
}

const LIVE_TOAST_DURATION = Infinity;

const TOAST_EXAMPLES: readonly ToastExample[] = [
  {
    id: "bb-app-update",
    group: "Updates",
    label: "bb app update",
    source: "useUpdateAvailableToast",
    usage: [
      "Production web app only",
      "New app version reported",
      "Once per version",
    ],
    current: {
      tone: "message",
      title: "bb-app update available",
      description: "0.0.7 is available. Restart bb-app to update.",
      secondaryActionLabel: "Dismiss",
    },
  },
  {
    id: "desktop-update-ready",
    group: "Updates",
    label: "desktop update ready",
    source: "useDesktopUpdateAvailableToast",
    usage: ["Desktop shell only", "Update downloaded", "Relaunch installs"],
    current: {
      tone: "message",
      title: "Desktop update ready",
      description: "bb desktop 0.0.2 is ready to install.",
      primaryActionLabel: "Relaunch",
    },
  },
  {
    id: "codex-provider-update",
    group: "Provider CLI",
    label: "Codex update",
    source: "ProviderCliHealthToasts",
    usage: ["Host daemon reports Codex outdated", "Install action available"],
    current: {
      tone: "warning",
      title: "Codex update available",
      description: "0.132.0 -> 0.133.0",
      primaryActionLabel: "Update",
      secondaryActionLabel: "Dismiss",
    },
  },
  {
    id: "claude-provider-update",
    group: "Provider CLI",
    label: "Claude update",
    source: "ProviderCliHealthToasts",
    usage: [
      "Host daemon reports Claude Code outdated",
      "Install action available",
    ],
    current: {
      tone: "warning",
      title: "Claude Code update available",
      description: "2.1.149 -> 2.1.150",
      primaryActionLabel: "Update",
      secondaryActionLabel: "Dismiss",
    },
  },
  {
    id: "provider-missing",
    group: "Provider CLI",
    label: "missing provider",
    source: "ProviderCliHealthToasts",
    usage: ["Provider CLI not installed", "Install starts host-daemon flow"],
    current: {
      tone: "warning",
      title: "Codex CLI not installed",
      description: "Install Codex so bb can start Codex sessions.",
      primaryActionLabel: "Install",
    },
  },
  {
    id: "provider-host-unavailable",
    group: "Provider CLI",
    label: "host daemon unavailable",
    source: "ProviderCliHealthToasts",
    usage: ["After clicking Install/Update", "Host daemon port unavailable"],
    current: {
      tone: "error",
      title: "Host daemon unavailable",
      description: "Start bb again and retry the provider CLI setup.",
    },
  },
  {
    id: "provider-already-running",
    group: "Provider CLI",
    label: "setup already running",
    source: "ProviderCliHealthToasts",
    usage: ["Click Install/Update while another setup is running"],
    current: {
      tone: "warning",
      title: "Provider CLI setup already running",
      description: "Wait for the current install or update to finish.",
    },
  },
  {
    id: "provider-up-to-date",
    group: "Provider CLI",
    label: "provider success",
    source: "ProviderCliHealthToasts",
    usage: ["Provider CLI install/update succeeds"],
    current: {
      tone: "success",
      title: "Codex is up to date",
    },
  },
  {
    id: "git-loading",
    group: "Git actions",
    label: "git loading",
    source: "useThreadGitActions",
    usage: ["Click Commit in thread header", "Replaced by success/error"],
    current: {
      tone: "loading",
      title: "Creating commit",
    },
  },
  {
    id: "git-success",
    group: "Git actions",
    label: "git success",
    source: "useThreadGitActions",
    usage: ["Thread git action succeeds", "Commit and squash merge"],
    current: {
      tone: "success",
      title: "Commit created",
      description: "e547e81 · Update provider CLI health toasts",
    },
  },
  {
    id: "git-error-ask-agent",
    group: "Git actions",
    label: "git error with action",
    source: "useThreadGitActions",
    usage: [
      "Thread git action fails",
      "Ask agent only for recoverable failures",
    ],
    current: {
      tone: "error",
      title: "Commit failed",
      description: "Command exited with code 1",
      primaryActionLabel: "Ask agent to fix",
    },
  },
  {
    id: "message-to-agent-success",
    group: "Git actions",
    label: "agent message success",
    source: "useThreadGitActions",
    usage: ["Ask agent to fix message sent"],
    current: {
      tone: "success",
      title: "Message sent",
    },
  },
  {
    id: "message-to-agent-error",
    group: "Git actions",
    label: "agent message error",
    source: "useThreadGitActions",
    usage: ["Ask agent to fix message failed"],
    current: {
      tone: "error",
      title: "Failed to message agent",
      description: "Message was not sent",
    },
  },
  {
    id: "archive-undo",
    group: "Thread actions",
    label: "archive undo",
    source: "ThreadActionsProvider",
    usage: ["Single thread archive succeeds", "Undo calls unarchive"],
    current: {
      tone: "success",
      title: "Thread archived",
      secondaryActionLabel: "Undo",
    },
  },
  {
    id: "archive-worktree-group",
    group: "Thread actions",
    label: "archive worktree group",
    source: "ProjectRow",
    usage: ["Sidebar project row", "Archive worktree group succeeds"],
    current: {
      tone: "success",
      title: "Archived 3 worktree threads",
    },
  },
  {
    id: "thread-action-error",
    group: "Thread actions",
    label: "thread action error",
    source: "ThreadActionsProvider",
    usage: ["Thread archive fails", "Title varies by thread type/error"],
    current: {
      tone: "error",
      title: "Failed to archive thread",
    },
  },
  {
    id: "prompt-send-error",
    group: "Prompt",
    label: "send message error",
    source: "ThreadDetailPromptArea",
    usage: ["Follow-up or steer send fails"],
    current: {
      tone: "error",
      title: "Failed to send message",
    },
  },
  {
    id: "queued-message-error",
    group: "Prompt",
    label: "queued message error",
    source: "ThreadDetailPromptArea",
    usage: ["Send queued message now fails", "Other queued actions differ"],
    current: {
      tone: "error",
      title: "Failed to send queued message",
    },
  },
  {
    id: "local-open-error",
    group: "Local files",
    label: "local open error",
    source: "useLocalOpenTargets / ThreadDetailView",
    usage: [
      "Local/workspace/storage open fails",
      "Target, daemon, path, or storage missing",
    ],
    current: {
      tone: "error",
      title: "Failed to open file locally",
      description: "Thread storage path is not available yet.",
    },
  },
  {
    id: "opening-editor",
    group: "Local files",
    label: "opening editor",
    source: "GitDiffCard story",
    usage: ["Story-only GitDiffCard fixture", "Open in editor handler runs"],
    current: {
      tone: "message",
      title: "Opening in editor",
      description: "apps/app/src/components/provider-cli/ProviderCliHealthToasts.tsx",
    },
  },
  {
    id: "clipboard-success",
    group: "Clipboard",
    label: "copy success",
    source: "copyToClipboardWithToast",
    usage: ["Default helper success", "Often overridden or suppressed"],
    current: {
      tone: "success",
      title: "Copied",
    },
  },
  {
    id: "clipboard-error",
    group: "Clipboard",
    label: "copy error",
    source: "copyToClipboardWithToast",
    usage: ["Clipboard unavailable or write fails", "Default unless overridden"],
    current: {
      tone: "error",
      title: "Failed to copy",
    },
  },
  {
    id: "mutation-error",
    group: "Mutation errors",
    label: "generic mutation error",
    source: "query-client / mutation-errors",
    usage: [
      "Global React Query mutation fallback",
      "No specific meta message",
      "Opt-out not set",
    ],
    current: {
      tone: "error",
      title: "Request failed",
      description: "Please try again",
    },
  },
  {
    id: "host-join-error",
    group: "Mutation errors",
    label: "host join error",
    source: "AppSettingsView",
    usage: ["Settings host join fails", "App URL required opens dialog"],
    current: {
      tone: "error",
      title: "Failed to create host join command",
    },
  },
  {
    id: "merge-base-error",
    group: "Merge base",
    label: "merge base error",
    source: "useEnvironmentMergeBase",
    usage: [
      "Merge-base update fails",
      "Provisioning not-ready suppressed",
      "Lifecycle warnings keep operation context",
    ],
    current: {
      tone: "warning",
      title: "Failed to update merge base",
      description: "Workspace is unavailable.",
    },
  },
];

function toastCatalogId(example: ToastExample): string {
  return `toast-catalog:${example.id}`;
}

function buildLiveToastOptions(example: ToastExample): AppToastOptions {
  const id = toastCatalogId(example);
  const { current } = example;
  const options: AppToastOptions = {
    id,
    duration: LIVE_TOAST_DURATION,
  };

  if (current.description) {
    options.description = current.description;
  }
  if (current.secondaryActionLabel) {
    options.cancel = {
      label: current.secondaryActionLabel,
      onClick: () => appToast.dismiss(id),
    };
  }
  if (current.primaryActionLabel) {
    options.action = {
      label: current.primaryActionLabel,
      onClick: () => appToast.dismiss(id),
    };
  }

  return options;
}

function showToastExample(example: ToastExample): void {
  const { current } = example;
  const options = buildLiveToastOptions(example);
  switch (current.tone) {
    case "success":
      appToast.success(current.title, options);
      return;
    case "warning":
      appToast.warning(current.title, options);
      return;
    case "error":
      appToast.error(current.title, options);
      return;
    case "loading":
      appToast.loading(current.title, options);
      return;
    case "message":
      appToast.message(current.title, options);
      return;
  }
}

function showAllToastExamples(): void {
  appToast.dismiss();
  for (const example of TOAST_EXAMPLES) {
    showToastExample(example);
  }
}

function CurrentToastPreview({ toast }: CurrentToastPreviewProps) {
  return (
    <AppToastContent
      action={
        toast.primaryActionLabel
          ? {
              label: toast.primaryActionLabel,
              onClick: () => undefined,
            }
          : undefined
      }
      cancel={
        toast.secondaryActionLabel
          ? {
              label: toast.secondaryActionLabel,
              onClick: () => undefined,
            }
          : undefined
      }
      description={toast.description}
      title={toast.title}
      tone={toast.tone}
    />
  );
}

function ToastRowHint({ example }: ToastRowHintProps) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-2">
      <span>{example.source}</span>
      <ToastUsageHint usage={example.usage} />
      <Button
        variant="outline"
        size="sm"
        className="text-foreground"
        onClick={() => showToastExample(example)}
      >
        Show
      </Button>
    </span>
  );
}

function ToastUsageHint({ usage }: ToastUsageHintProps) {
  if (usage.length === 1) {
    return <span className="leading-4">{usage[0]}</span>;
  }

  return (
    <span className="flex min-w-0 flex-col gap-1 leading-4">
      {usage.map((item) => (
        <span
          key={item}
          className="relative pl-3 before:absolute before:left-0 before:top-1.5 before:size-1 before:rounded-full before:bg-muted-foreground/70"
        >
          {item}
        </span>
      ))}
    </span>
  );
}

export function Catalog() {
  return (
    <>
      <StoryCard labelWidth="260px">
        <StoryRow
          label="live controls"
          hint="Trigger the implemented appToast stack rendered by the Ladle provider."
        >
          <Button onClick={showAllToastExamples}>
            Trigger all live toasts
          </Button>
          <Button variant="outline" onClick={() => appToast.dismiss()}>
            Dismiss live toasts
          </Button>
        </StoryRow>
      </StoryCard>

      <StoryCard labelWidth="320px" className="items-start gap-y-6 py-5">
        {TOAST_EXAMPLES.map((example) => (
          <StoryRow
            key={example.id}
            label={`${example.group} / ${example.label}`}
            hint={<ToastRowHint example={example} />}
          >
            <CurrentToastPreview toast={example.current} />
          </StoryRow>
        ))}
      </StoryCard>
    </>
  );
}
