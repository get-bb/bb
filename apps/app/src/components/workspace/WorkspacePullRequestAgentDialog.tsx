import { useState, type FormEvent } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import type { ExistingThreadExecutionInputSources } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Textarea } from "@bb/shared-ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  ExecutionControls,
  type ExecutionControlsProps,
} from "@/components/promptbox/ExecutionControls";

export const DEFAULT_PULL_REQUEST_AGENT_PROMPT =
  "Review the current branch and create a pull request for these changes. Use the repository conventions to write a concise title and description, then create the pull request with the available GitHub CLI. Do not make unrelated changes. Return the pull request URL when it is ready.";

export const DEFAULT_DRAFT_PULL_REQUEST_AGENT_PROMPT =
  "Review the current branch and create a draft pull request for these changes. Use the repository conventions to write a concise title and description, then create the draft pull request with the available GitHub CLI. Do not make unrelated changes. Return the pull request URL when it is ready.";

export interface WorkspacePullRequestDraft {
  title: string;
  description: string;
}

export const EMPTY_WORKSPACE_PULL_REQUEST_DRAFT: WorkspacePullRequestDraft = {
  title: "",
  description: "",
};

export interface WorkspacePullRequestAgentConfig {
  execution: ExecutionControlsProps;
  executionInputSources: ExistingThreadExecutionInputSources;
  model: string;
  permissionMode: PermissionMode;
  providerId: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
}

export interface StartPullRequestAgentRequest {
  executionInputSources: ExistingThreadExecutionInputSources;
  model: string;
  permissionMode: PermissionMode;
  prompt: string;
  providerId: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
}

interface WorkspacePullRequestAgentDialogProps {
  agentConfig: WorkspacePullRequestAgentConfig | null;
  initialPrompt?: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (request: StartPullRequestAgentRequest) => Promise<void>;
  open: boolean;
}

export function WorkspacePullRequestAgentDialog({
  agentConfig,
  initialPrompt = DEFAULT_PULL_REQUEST_AGENT_PROMPT,
  isSubmitting,
  onOpenChange,
  onSubmit,
  open,
}: WorkspacePullRequestAgentDialogProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const trimmedPrompt = prompt.trim();
  const canSubmit = agentConfig !== null && trimmedPrompt.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agentConfig || !canSubmit) return;
    await onSubmit({
      executionInputSources: agentConfig.executionInputSources,
      model: agentConfig.model,
      permissionMode: agentConfig.permissionMode,
      prompt: trimmedPrompt,
      providerId: agentConfig.providerId,
      reasoningLevel: agentConfig.reasoningLevel,
      serviceTier: agentConfig.serviceTier,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[34rem] gap-0 overflow-hidden border-border bg-background p-0 shadow-sm">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="border-b border-border-seam px-5 py-4">
            <DialogTitle>Ask an agent to create the PR</DialogTitle>
            <DialogDescription>
              The agent will work in this thread&apos;s workspace, inspect the
              branch, and create the pull request.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            <div className="space-y-2">
              <span className="text-xs font-medium">Agent</span>
              {agentConfig ? (
                <div
                  className="rounded-md border border-input px-2 py-1"
                  id="pr-agent"
                >
                  <ExecutionControls {...agentConfig.execution} />
                </div>
              ) : (
                <p className="rounded-md border border-input px-3 py-2 text-xs text-muted-foreground">
                  Loading available agents…
                </p>
              )}
              <p className="text-2xs text-muted-foreground">
                Choose the provider and model that should run this task.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium" htmlFor="pr-agent-prompt">
                Prompt
              </label>
              <Textarea
                id="pr-agent-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                disabled={isSubmitting}
                rows={6}
                className="resize-y text-xs leading-5"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-border-seam px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting || !canSubmit}
            >
              {isSubmitting ? "Starting agent…" : "Start agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
