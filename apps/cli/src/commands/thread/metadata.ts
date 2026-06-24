import { Command } from "commander";
import type { ThreadMetadataResult } from "@bb/sdk";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  outputJson,
  printContextLabel,
  requireThreadIdWithLabelOrSelf,
} from "../helpers.js";
import { statusText } from "./helpers.js";

interface ThreadMetadataCommandOptions {
  json?: boolean;
  self?: boolean;
}

function formatValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function formatDate(timestamp: number | null): string {
  return timestamp === null ? "-" : new Date(timestamp).toLocaleString();
}

function plural(count: number, singular: string, pluralValue: string): string {
  return count === 1 ? singular : pluralValue;
}

function printPullRequest(metadata: ThreadMetadataResult): void {
  const { pullRequest } = metadata;
  console.log("");
  if (pullRequest.status === "available" && pullRequest.pullRequest) {
    const pr = pullRequest.pullRequest;
    console.log("Pull request:");
    console.log(`  PR:        #${pr.number} ${pr.state} - ${pr.title}`);
    console.log(`  URL:       ${pr.url}`);
    console.log(`  Branch:    ${pr.headRefName} -> ${pr.baseRefName}`);
    console.log(`  Attention: ${pr.attention}`);
    console.log(
      `  Checks:    ${pr.checks.state} (${pr.checks.passedCount} passed, ` +
        `${pr.checks.failedCount} failed, ${pr.checks.pendingCount} pending, ` +
        `${pr.checks.totalCount} total)`,
    );
    console.log(
      `  Review:    ${pr.review.state} (${pr.review.reviewRequestCount} requested)`,
    );
    console.log(`  Merge:     ${pr.mergeability.state}`);
    return;
  }

  const label =
    pullRequest.status === "not_found"
      ? "none found"
      : pullRequest.status === "not_applicable"
        ? "not applicable"
        : "unavailable";
  console.log(`Pull request: ${label}`);
  if (pullRequest.message) {
    console.log(`  ${pullRequest.message}`);
  }
}

function printEventMetadata(metadata: ThreadMetadataResult): void {
  const { eventMetadata } = metadata;
  console.log("");
  console.log("Event metadata:");
  console.log(
    `  Events:    ${eventMetadata.totalEventCount} total, ` +
      `${eventMetadata.eventsWithMetadataCount} with metadata`,
  );
  console.log(`  Objects:   ${eventMetadata.metadataObjectCount}`);
  if (eventMetadata.categories.length === 0) {
    console.log("  Categories: none");
    return;
  }
  console.log("  Categories:");
  for (const category of eventMetadata.categories) {
    const eventLabel = plural(category.eventCount, "event", "events");
    const objectLabel = plural(
      category.metadataObjectCount,
      "object",
      "objects",
    );
    console.log(
      `    ${category.source}: ${category.eventCount} ${eventLabel}, ` +
        `${category.metadataObjectCount} ${objectLabel}; keys: ` +
        `${category.keys.length > 0 ? category.keys.join(", ") : "-"}`,
    );
  }
}

function printThreadMetadata(metadata: ThreadMetadataResult): void {
  const { thread, environment, spawn, timestamps } = metadata;
  console.log(`Thread metadata: ${thread.id}`);
  console.log(`  Title:     ${formatValue(thread.title ?? thread.titleFallback)}`);
  console.log(`  Status:    ${statusText(thread.status)}`);
  console.log(`  Provider:  ${thread.providerId}`);
  console.log(`  Project:   ${thread.projectId}`);
  console.log(`  Parent:    ${formatValue(thread.parentThreadId)}`);
  console.log(`  Source:    ${formatValue(thread.sourceThreadId)}`);
  console.log(`  Origin:    ${formatValue(thread.originKind)}`);

  console.log("");
  console.log("Environment:");
  if (environment) {
    console.log(`  ID:        ${environment.id}`);
    console.log(`  Status:    ${environment.status}`);
    console.log(`  Branch:    ${formatValue(environment.branchName)}`);
    console.log(`  Path:      ${formatValue(environment.path)}`);
    console.log(`  Worktree:  ${environment.workspaceProvisionType}`);
  } else {
    console.log("  none");
  }

  console.log("");
  console.log("Spawn execution:");
  if (spawn.execution) {
    console.log(`  Model:      ${spawn.execution.model}`);
    console.log(`  Tier:       ${spawn.execution.serviceTier}`);
    console.log(`  Reasoning:  ${spawn.execution.reasoningLevel}`);
    console.log(`  Permission: ${spawn.execution.permissionMode}`);
    console.log(`  Source:     ${spawn.execution.source}`);
    console.log(`  Requested:  ${formatDate(spawn.requestedAt)}`);
    console.log(`  Event seq:  ${formatValue(spawn.eventSeq)}`);
    console.log(`  Request:    ${formatValue(spawn.requestMethod)}`);
    console.log(`  Initiator:  ${formatValue(spawn.initiator)}`);
    console.log(`  Sender:     ${formatValue(spawn.senderThreadId)}`);
  } else {
    console.log("  none found");
  }

  console.log("");
  console.log("Timestamps:");
  console.log(`  Created:     ${formatDate(timestamps.createdAt)}`);
  console.log(`  Updated:     ${formatDate(timestamps.updatedAt)}`);
  console.log(`  Archived:    ${formatDate(timestamps.archivedAt)}`);
  console.log(`  Pinned:      ${formatDate(timestamps.pinnedAt)}`);
  console.log(`  First event: ${formatDate(timestamps.firstEventAt)}`);
  console.log(`  Last event:  ${formatDate(timestamps.lastEventAt)}`);

  printEventMetadata(metadata);
  printPullRequest(metadata);
}

export function registerMetadataCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("metadata [id]")
    .description("Show thread metadata")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadMetadataCommandOptions) => {
          const resolved = requireThreadIdWithLabelOrSelf(id, opts);
          printContextLabel(resolved, "Thread", "BB_THREAD_ID", opts);
          const sdk = createCliBbSdk(getUrl());
          const metadata = await sdk.threads.metadata({
            threadId: resolved.id,
          });
          if (outputJson(opts, metadata)) return;
          printThreadMetadata(metadata);
        },
      ),
    );
}
