import type { AvailableModel, ProviderInfo } from "@bb/domain";
import type { HostDaemonWorkflowListing } from "@bb/host-daemon-contract";
import { WorkflowRunDialogContent } from "./WorkflowRunDialog";
import {
  HOST_IDS,
  HOST_NAMES,
  makeHost,
} from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Workflow Run",
};

const noop = () => {};

function makeAvailableModel(model: string, displayName: string): AvailableModel {
  return {
    id: model,
    model,
    displayName,
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: false,
  };
}

const claudeCodeModels: AvailableModel[] = [
  makeAvailableModel("claude-opus-4-7-1m", "Claude Opus 4.7 (1M)"),
  makeAvailableModel("claude-opus-4-7", "Claude Opus 4.7"),
  makeAvailableModel("claude-sonnet-4-6", "Claude Sonnet 4.6"),
  makeAvailableModel("claude-haiku-4-5", "Claude Haiku 4.5"),
];

function makeProviderInfo(id: string, displayName: string): ProviderInfo {
  return {
    id,
    displayName,
    capabilities: {
      supportsArchive: true,
      supportsRename: true,
      supportsServiceTier: false,
      supportsUserQuestion: true,
      supportedPermissionModes: ["workspace-write"],
    },
    available: true,
  };
}

const providers: ProviderInfo[] = [
  makeProviderInfo("codex", "Codex"),
  makeProviderInfo("claude-code", "Claude Code"),
  makeProviderInfo("pi", "Pi"),
];

const deepResearch: HostDaemonWorkflowListing = {
  name: "deep-research",
  description:
    "Fan out research agents across independent sources, then synthesize a cited report.",
  whenToUse:
    "Broad questions that benefit from many independent perspectives.",
  defaultProvider: "claude-code",
  defaultModel: "claude-haiku-4-5-20251001",
  defaultSandbox: "read-only",
  tier: "project",
};

const codeReview: HostDaemonWorkflowListing = {
  name: "code-review",
  description:
    "Parallel reviewers sweep a diff for correctness bugs; a judge merges findings.",
  tier: "builtin",
};

const storyHosts = [
  makeHost({ id: HOST_IDS.local, name: HOST_NAMES.local }),
  makeHost({ id: HOST_IDS.remote, name: HOST_NAMES.remote, type: "persistent", status: "connected" }),
];

const singleSourceHostIds: string[] = [storyHosts[0].id];
const multiSourceHostIds: string[] = [storyHosts[0].id, storyHosts[1].id];

const baseProps = {
  hosts: storyHosts,
  defaultHostId: storyHosts[0].id,
  providers,
  models: [],
  providerOverride: "",
  onProviderOverrideChange: noop,
  pending: false,
  errorMessage: null,
  onLaunch: noop,
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="single source"
        hint="one source host — no host select renders (the M5 exit criterion); meta defaults seed the override labels"
      >
        <DialogStage>
          <WorkflowRunDialogContent
            {...baseProps}
            sourceHostIds={singleSourceHostIds}
            workflow={deepResearch}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="multi-host"
        hint="sources on two hosts — the composer host select renders, seeded with the default source's host"
      >
        <DialogStage>
          <WorkflowRunDialogContent
            {...baseProps}
            sourceHostIds={multiSourceHostIds}
            workflow={deepResearch}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="no meta defaults"
        hint="a workflow whose meta declares no defaults — override labels fall back to server policy"
      >
        <DialogStage>
          <WorkflowRunDialogContent
            {...baseProps}
            sourceHostIds={singleSourceHostIds}
            workflow={codeReview}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}

export function ProviderOverride() {
  return (
    <StoryCard>
      <StoryRow
        label="provider override selected"
        hint="claude-code overrides the meta default; the model picker offers that provider's catalog"
      >
        <DialogStage>
          <WorkflowRunDialogContent
            {...baseProps}
            models={claudeCodeModels}
            providerOverride="claude-code"
            sourceHostIds={singleSourceHostIds}
            workflow={deepResearch}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}

export function LaunchError() {
  return (
    <StoryCard>
      <StoryRow
        label="server 422"
        hint="policy rejections (e.g. workflow_sandbox_not_allowed) render inline — the dialog never duplicates policy client-side"
      >
        <DialogStage>
          <WorkflowRunDialogContent
            {...baseProps}
            errorMessage="Sandbox danger-full-access is not allowed for this project."
            sourceHostIds={singleSourceHostIds}
            workflow={deepResearch}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}

export function Pending() {
  return (
    <StoryCard>
      <StoryRow label="launching" hint="controls disabled while the launch request is in flight">
        <DialogStage>
          <WorkflowRunDialogContent
            {...baseProps}
            pending={true}
            sourceHostIds={singleSourceHostIds}
            workflow={deepResearch}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
