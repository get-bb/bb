import type { AgentPreset } from "./pull-status.js";

export type BranchCheckout = "same-branch" | "new-branch" | "checkout";

export interface PresetPull {
  repo: string;
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  branchCheckout: BranchCheckout;
}

export const AGENT_PRESETS: ReadonlyArray<{ id: AgentPreset; label: string }> =
  [
    { id: "fix", label: "Fix checks" },
    { id: "conflicts", label: "Resolve conflicts" },
    { id: "feedback", label: "Address review" },
    { id: "review", label: "Review" },
  ];

export function presetLabel(preset: AgentPreset): string {
  return AGENT_PRESETS.find((entry) => entry.id === preset)?.label ?? "Agent";
}

export function agentThreadTitle(
  preset: AgentPreset,
  pull: PresetPull,
): string {
  return `${presetLabel(preset)} · ${pull.repo}#${pull.number}: ${pull.title}`.slice(
    0,
    120,
  );
}

function checkoutLine(pull: PresetPull): string {
  switch (pull.branchCheckout) {
    case "same-branch":
      return `You are on ${pull.headRefName}; push to it when you are done.`;
    case "new-branch":
      return `This worktree starts at the head of ${pull.headRefName}; push your commits to that branch.`;
    case "checkout":
      return `Check out the branch first with \`gh pr checkout ${pull.number} -R ${pull.repo}\`, and push to it when you are done.`;
  }
}

export function presetPrompt(preset: AgentPreset, pull: PresetPull): string {
  const ref = `${pull.repo}#${pull.number}`;
  switch (preset) {
    case "fix":
      return [
        `Fix the failing checks on ${ref} (${pull.headRefName} → ${pull.baseRefName}).`,
        "Find the cause in the failed runs and keep the change small.",
        checkoutLine(pull),
        "Don't merge.",
      ].join("\n");
    case "conflicts":
      return [
        `Rebase ${ref} (${pull.headRefName}) on ${pull.baseRefName} and resolve the conflicts.`,
        checkoutLine(pull),
        "Push with --force-with-lease. Ask me as soon as a conflict is a product decision.",
      ].join("\n");
    case "feedback":
      return [
        `Address the review feedback on ${ref}: ${pull.title}`,
        checkoutLine(pull),
        "Don't merge.",
      ].join("\n");
    case "review":
      return [
        `Review ${ref}: ${pull.title}`,
        "Check correctness, missing tests and design. Report findings with file:line. Don't push or post to GitHub unless I ask.",
      ].join("\n");
  }
}

export interface IssueForAgent {
  repo: string;
  number: number;
  title: string;
}

export function issueThreadTitle(issue: IssueForAgent): string {
  return `${issue.repo}#${issue.number}: ${issue.title}`.slice(0, 120);
}

export function issuePrompt(issue: IssueForAgent): string {
  return [
    `Work on GitHub issue ${issue.repo}#${issue.number}: ${issue.title}`,
    "Read it and its comments first.",
    `Make the fix or the change it asks for. If you open a pull request, put "Fixes #${issue.number}" in its body.`,
  ].join("\n");
}
