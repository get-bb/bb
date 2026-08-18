import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createFakeAdapter } from "@bb/agent-runtime/test";
import { getLatestSessionForHost, listPublicHosts } from "@bb/db";
import { encodeClientTurnRequestIdNumber, type Principal } from "@bb/domain";
import { describe, expect, it } from "vitest";

import type { PrincipalPolicy } from "../../../apps/server/src/auth/principal-policy.js";
import { createBindingBackedRoomDistributionV1 } from "../../../apps/server/src/room-distribution/binding-backed-room-distribution.js";
import {
  createHostWorkTogetherGithubRepositoryResolver,
  createLiveWorkTogetherRoomResourceRegistry,
} from "../../../apps/server/src/room-distribution/room-resource-live-registry.js";
import { createWorkTogetherRoomResourceProvisioner } from "../../../apps/server/src/room-distribution/room-resource-provisioner.js";
import type { WorkTogetherRoomChildAttachmentV1 } from "../../../apps/server/src/room-distribution/work-together-room-child-attachments.js";
import { resolveDetachedReadOnlyOutputPath } from "../../../apps/server/src/services/threads/worktree-paths.js";
import {
  archiveThread,
  createProject,
  getEnvironment,
  getThread,
  getThreadEvents,
  sendTextMessage,
} from "../helpers/api.js";
import {
  waitForEnvironmentStatus,
  waitForThreadStatus,
} from "../helpers/assertions.js";
import { withHarness } from "../helpers/harness.js";
import { runGit } from "../helpers/seed.js";

const execFile = promisify(execFileCallback);
const PUBLIC_CONTRACT_VERSION = 2;
const SYNTHETIC_PROVIDER_SCRIPT = fileURLToPath(
  new URL("./gw03-s0-synthetic-provider.ts", import.meta.url),
);
const SYNTHETIC_AGENT_TOKEN = "gw03-candidate-agent-child-create";
const CREDENTIAL_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CODEX_API_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "OPENAI_API_KEY",
] as const;
const PRINCIPAL: Principal = Object.freeze({
  id: "user_Gw03Candidate",
  kind: "human",
  displayName: "GW03 Candidate",
});
const REPOSITORY = Object.freeze({
  repositorySnapshotId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  repositoryBindingId: "44444444-4444-4444-8444-444444444444",
  repositoryBindingVersion: 7,
  providerRepositoryId: "42",
  objectFormat: "sha1",
  baseRevision: "a".repeat(40),
});

function uuid(sequence: number): string {
  return `90000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function launchIdentity(sequence: number): {
  candidateHostId: string;
  cellId: string;
  taskId: string;
  workspaceId: string;
} {
  return {
    workspaceId: uuid(sequence * 10 + 1),
    taskId: uuid(sequence * 10 + 2),
    cellId: uuid(sequence * 10 + 3),
    candidateHostId: "55555555-5555-4555-8555-555555555555",
  };
}

async function candidateIdentity(): Promise<{
  digest: string;
  version: string;
}> {
  const [{ stdout: version }, { stdout: listed }] = await Promise.all([
    execFile("git", ["rev-parse", "HEAD"], { encoding: "utf8" }),
    execFile(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
    ),
  ]);
  const digest = createHash("sha256");
  const files = listed.toString("utf8").split("\0").filter(Boolean).sort();
  for (const file of files) {
    const stat = await fs.lstat(file);
    const content = stat.isSymbolicLink()
      ? Buffer.from(await fs.readlink(file), "utf8")
      : await fs.readFile(file);
    digest.update(file, "utf8");
    digest.update("\0");
    digest.update(content);
    digest.update("\0");
  }
  return { digest: digest.digest("hex"), version: version.trim() };
}

async function postLaunch(
  serverUrl: string,
  bindingId: string,
  body: unknown,
): Promise<Response> {
  return fetch(
    `${serverUrl}/api/bb-room-provisioning/v2/room-bindings/${bindingId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

async function postRoomCommand(
  serverUrl: string,
  bindingId: string,
  command: unknown,
): Promise<{ body: unknown; status: number }> {
  const response = await fetch(
    `${serverUrl}/api/bb-rooms/v1/rooms/${bindingId}/commands`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    },
  );
  return { status: response.status, body: await response.json() };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function workResultSubmission(
  kind: "code" | "research" | "writing",
  summary: string,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind,
    summary,
    decisions: [{ id: "decision-1", text: "Keep the durable seam." }],
    nextActions: [{ id: "next-1", text: "Continue verification." }],
    sourceRefs: [],
    artifactRefs: [],
  };
}

function publicSubagentId(projection: unknown): string {
  const bootstrap = requireObject(projection, "Room bootstrap");
  if (!Array.isArray(bootstrap.subagents) || bootstrap.subagents.length !== 1) {
    throw new Error("Room bootstrap must contain one direct Subagent");
  }
  const subagent = requireObject(bootstrap.subagents[0], "Room Subagent");
  if (typeof subagent.id !== "string") {
    throw new Error("Room Subagent must have a public id");
  }
  return subagent.id;
}

async function waitForHostInactive(
  db: Parameters<typeof getLatestSessionForHost>[0],
  hostId: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() <= deadline) {
    if (getLatestSessionForHost(db, { hostId })?.status !== "active") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Host session remained active after candidate shutdown");
}

async function waitForReadyLaunch(
  serverUrl: string,
  bindingId: string,
  body: unknown,
): Promise<{
  environmentId: string;
  primaryThreadId: string;
  projectId: string;
}> {
  const deadline = Date.now() + 15_000;
  let lastStatus = 0;
  let lastBody: unknown = null;
  while (Date.now() <= deadline) {
    const response = await postLaunch(serverUrl, bindingId, body);
    lastStatus = response.status;
    lastBody = await response.json();
    if (
      response.status === 200 &&
      typeof lastBody === "object" &&
      lastBody !== null &&
      "state" in lastBody &&
      lastBody.state === "ready" &&
      "environmentId" in lastBody &&
      typeof lastBody.environmentId === "string" &&
      "primaryThreadId" in lastBody &&
      typeof lastBody.primaryThreadId === "string" &&
      "projectId" in lastBody &&
      typeof lastBody.projectId === "string"
    ) {
      return {
        environmentId: lastBody.environmentId,
        primaryThreadId: lastBody.primaryThreadId,
        projectId: lastBody.projectId,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Scratch Primary did not reach ready: status=${lastStatus} body=${JSON.stringify(lastBody)}`,
  );
}

type SyntheticFilesystemAction =
  | {
      content: string;
      operation: "write";
      path: string;
    }
  | {
      operation: "copy";
      sourcePath: string;
      targetPath: string;
    }
  | {
      args: string[];
      cwd: string;
      executable: "chmod" | "git";
      operation: "exec";
      stdin?: string;
    }
  | {
      content: string;
      cwd: string;
      operation: "escape_exec";
      targetPath: string;
      vector: "environment_variable" | "tool_path_alias";
    };

interface SyntheticChildSpawnReceipt {
  body: {
    environmentId: string | null;
    id: string;
    parentThreadId: string | null;
    projectId: string;
  };
  error: string | null;
  ok: boolean;
  status: number;
}

async function runSyntheticFilesystemAction(args: {
  action: SyntheticFilesystemAction;
  expectedOk: boolean;
  receiptPath: string;
  threadId: string;
  api: Parameters<typeof sendTextMessage>[0];
}): Promise<void> {
  const encoded = Buffer.from(
    JSON.stringify({ ...args.action, receiptPath: args.receiptPath }),
    "utf8",
  ).toString("base64url");
  await sendTextMessage(args.api, args.threadId, {
    text: `gw03_fs:${encoded}`,
  });
  await waitForThreadStatus(args.api, args.threadId, "idle", 10_000);
  const receipt: unknown = JSON.parse(
    await fs.readFile(args.receiptPath, "utf8"),
  );
  expect(receipt).toEqual({
    ok: args.expectedOk,
    error: args.expectedOk ? null : "policy_denied",
  });
}

async function runSyntheticChildSpawn(args: {
  api: Parameters<typeof sendTextMessage>[0];
  parentThreadId: string;
  projectId: string;
  providerId: string;
  receiptPath: string;
}): Promise<SyntheticChildSpawnReceipt["body"]> {
  const request = {
    environment: { type: "project-default" },
    input: [
      {
        type: "text",
        text: "Start the direct GW03 synthetic Subagent.",
        mentions: [],
      },
    ],
    origin: "sdk",
    originKind: null,
    parentThreadId: args.parentThreadId,
    projectId: args.projectId,
    providerId: args.providerId,
    startedOnBehalfOf: null,
    title: "GW03 direct synthetic Subagent",
  };
  const encoded = Buffer.from(
    JSON.stringify({
      operation: "spawn_child",
      parentThreadId: args.parentThreadId,
      receiptPath: args.receiptPath,
      request,
    }),
    "utf8",
  ).toString("base64url");
  await sendTextMessage(args.api, args.parentThreadId, {
    text: `gw03_fs:${encoded}`,
  });
  await waitForThreadStatus(args.api, args.parentThreadId, "idle", 10_000);
  const receipt = JSON.parse(
    await fs.readFile(args.receiptPath, "utf8"),
  ) as SyntheticChildSpawnReceipt;
  expect(receipt).toMatchObject({
    ok: true,
    error: null,
    status: 201,
    body: {
      id: expect.any(String),
      projectId: args.projectId,
      parentThreadId: args.parentThreadId,
    },
  });
  await waitForThreadStatus(args.api, receipt.body.id, "idle", 10_000);
  return receipt.body;
}

async function runSyntheticMutationCommand(args: {
  action: Extract<SyntheticFilesystemAction, { operation: "exec" }>;
  receiptPath: string;
  threadId: string;
  api: Parameters<typeof sendTextMessage>[0];
}): Promise<void> {
  const encoded = Buffer.from(
    JSON.stringify({ ...args.action, receiptPath: args.receiptPath }),
    "utf8",
  ).toString("base64url");
  await sendTextMessage(args.api, args.threadId, {
    text: `gw03_fs:${encoded}`,
  });
  await waitForThreadStatus(args.api, args.threadId, "idle", 10_000);
  const receipt: unknown = JSON.parse(
    await fs.readFile(args.receiptPath, "utf8"),
  );
  expect(receipt).toMatchObject({
    ok: false,
    error: "command_failed",
    exitCode: expect.any(Number),
    stderr: expect.any(String),
  });
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    !("exitCode" in receipt) ||
    typeof receipt.exitCode !== "number" ||
    !("stderr" in receipt) ||
    typeof receipt.stderr !== "string"
  ) {
    throw new Error("Synthetic mutation receipt is malformed");
  }
  expect(receipt.exitCode).not.toBe(0);
  expect(receipt.stderr).not.toMatch(/^bwrap:/u);
  expect(receipt.stderr).toMatch(
    /read-only|permission denied|operation not permitted|unable to (?:create|write)|could not lock|not a git repository/iu,
  );
}

async function runSyntheticEscapeCommand(args: {
  action: Extract<SyntheticFilesystemAction, { operation: "escape_exec" }>;
  api: Parameters<typeof sendTextMessage>[0];
  receiptPath: string;
  threadId: string;
}): Promise<void> {
  const encoded = Buffer.from(
    JSON.stringify({ ...args.action, receiptPath: args.receiptPath }),
    "utf8",
  ).toString("base64url");
  await sendTextMessage(args.api, args.threadId, {
    text: `gw03_fs:${encoded}`,
  });
  await waitForThreadStatus(args.api, args.threadId, "idle", 10_000);
  const receipt: unknown = JSON.parse(
    await fs.readFile(args.receiptPath, "utf8"),
  );
  expect(receipt).toMatchObject({
    ok: false,
    error: "command_failed",
    exitCode: expect.any(Number),
    stderr: expect.any(String),
  });
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    !("exitCode" in receipt) ||
    typeof receipt.exitCode !== "number" ||
    !("stderr" in receipt) ||
    typeof receipt.stderr !== "string"
  ) {
    throw new Error("Synthetic escape receipt is malformed");
  }
  expect(receipt.exitCode).not.toBe(0);
  expect(receipt.stderr).not.toMatch(/^bwrap:/u);
  expect(receipt.stderr).toMatch(/read-only|permission denied/iu);
}

describe.sequential("GW03-S0 composed candidate", () => {
  it("runs public contract v2 section 7 chronologically and stops on the first miss", async () => {
    const identity = await candidateIdentity();
    console.log(
      `GW03_S0_CANDIDATE ${JSON.stringify({ ...identity, publicContractVersion: PUBLIC_CONTRACT_VERSION })}`,
    );

    const savedCredentialEnv = new Map<string, string | undefined>();
    for (const key of CREDENTIAL_ENV_KEYS) {
      savedCredentialEnv.set(key, process.env[key]);
      delete process.env[key];
    }
    const savedPath = process.env.PATH;
    const savedGhConfigDir = process.env.GH_CONFIG_DIR;
    const syntheticGithubRoot = await fs.mkdtemp(
      path.join(tmpdir(), "gw03-synthetic-github-"),
    );
    const syntheticGhConfigDir = path.join(syntheticGithubRoot, "config");
    await fs.mkdir(syntheticGhConfigDir);
    await fs.writeFile(
      path.join(syntheticGithubRoot, "gh"),
      "#!/bin/sh\nprintf 'gw03/synthetic-repo\\n'\n",
      { encoding: "utf8", mode: 0o755 },
    );
    process.env.PATH = `${syntheticGithubRoot}${path.delimiter}${savedPath ?? ""}`;
    process.env.GH_CONFIG_DIR = syntheticGhConfigDir;

    let repositoryLookupCount = 0;
    let diagnoseProvisionError = false;
    let provisionErrorPrinted = false;
    let candidateServerUrl = "";
    const attachments: WorkTogetherRoomChildAttachmentV1[] = [];
    const attachmentBindingIds = new Map<string, string>();
    const agentThreadIds = new Set<string>();
    const policy: PrincipalPolicy = {
      async resolve(request) {
        const requestedAgentThreadId = request.getHeader("x-gw03-agent-thread");
        const isVerifiedAgent =
          request.getHeader("x-gw03-agent-token") === SYNTHETIC_AGENT_TOKEN &&
          requestedAgentThreadId !== undefined &&
          agentThreadIds.has(requestedAgentThreadId);
        const principal: Principal = isVerifiedAgent
          ? Object.freeze({
              id: `agent:thread/${requestedAgentThreadId}`,
              kind: "agent" as const,
              displayName: "GW03 synthetic Primary agent",
            })
          : PRINCIPAL;
        return Object.freeze({
          principal,
          expiresAtMs: Date.now() + 60_000,
          clientRealtimeScope: "scoped" as const,
          async authorize() {
            return { allowed: true as const };
          },
        });
      },
    };

    try {
      await withHarness(
        {
          hostId: "host_23456789ab",
          loadProjectEnv: false,
          adapterFactory: (providerId, adapterOptions) => {
            const adapter = createFakeAdapter({
              id: providerId,
              displayName: providerId,
              scriptPath: SYNTHETIC_PROVIDER_SCRIPT,
            });
            return {
              ...adapter,
              process: {
                ...adapter.process,
                env: {
                  ...adapter.process.env,
                  GW03_SYNTHETIC_FILESYSTEM_POLICY: JSON.stringify({
                    workspaceReadOnly:
                      adapterOptions.workspaceReadOnly === true,
                    additionalWorkspaceWriteRoots: [
                      ...adapterOptions.additionalWorkspaceWriteRoots,
                    ],
                  }),
                  GW03_SERVER_URL: candidateServerUrl,
                  GW03_AGENT_TOKEN: SYNTHETIC_AGENT_TOKEN,
                },
              },
            };
          },
          appOptionsFactory(deps) {
            const resolveGithubRepository =
              createHostWorkTogetherGithubRepositoryResolver(deps);
            const registry = createLiveWorkTogetherRoomResourceRegistry({
              db: deps.db,
              async resolveGithubRepository(args) {
                repositoryLookupCount += 1;
                return resolveGithubRepository(args);
              },
            });
            const roomDistribution = createBindingBackedRoomDistributionV1(
              deps,
              {
                async read() {
                  return Object.freeze({ title: "GW03 candidate task" });
                },
              },
              {
                async attach(input) {
                  const existing = attachments.find(
                    (entry) => entry.childThreadId === input.childThreadId,
                  );
                  if (existing) return existing;
                  const attachment = Object.freeze({
                    id: uuid(800 + attachments.length),
                    childThreadId: input.childThreadId,
                    parentThreadId: input.parentThreadId,
                  });
                  attachments.push(attachment);
                  attachmentBindingIds.set(attachment.id, input.bindingId);
                  return attachment;
                },
                async list(input) {
                  return attachments.filter(
                    (attachment) =>
                      attachmentBindingIds.get(attachment.id) ===
                      input.bindingId,
                  );
                },
              },
              {
                async read() {
                  return Object.freeze({
                    isTaskAssignee: true,
                    role: "owner" as const,
                  });
                },
              },
            );
            const roomResourceProvisioner =
              createWorkTogetherRoomResourceProvisioner(deps, registry);
            return {
              principalMode: "work-together",
              principalPolicy: policy,
              roomDistribution,
              roomResourceProvisioner: {
                async provision(input) {
                  try {
                    return await roomResourceProvisioner.provision(input);
                  } catch (error) {
                    if (diagnoseProvisionError && !provisionErrorPrinted) {
                      provisionErrorPrinted = true;
                      console.log(
                        `GW03_S0_UNMASKED_PROVISION_ERROR ${
                          error instanceof Error
                            ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
                            : String(error)
                        }`,
                      );
                    }
                    throw error;
                  }
                },
              },
            };
          },
        },
        async (harness) => {
          candidateServerUrl = harness.serverUrl;
          // Case 1: isolate decoder acceptance from provisioning availability.
          await harness.shutdownDaemon("gw03-decoder-matrix");
          await waitForHostInactive(harness.db, harness.hostId);

          const accepted = [
            {
              ...launchIdentity(1),
              environmentTemplate: "isolated-scratch",
              workKind: "writing",
            },
            {
              ...launchIdentity(2),
              ...REPOSITORY,
              environmentTemplate: "detached-read-only",
              workKind: "research",
            },
            {
              ...launchIdentity(3),
              ...REPOSITORY,
              environmentTemplate: "managed-worktree",
              workKind: "code",
              baseBranch: "main",
              generatedBranch: "rooms/gw03-candidate",
            },
          ];
          for (const [index, body] of accepted.entries()) {
            const response = await postLaunch(
              harness.serverUrl,
              uuid(index + 1),
              body,
            );
            expect(
              response.status,
              `accepted decoder variant ${index + 1}`,
            ).toBe(503);
          }

          const scratch = accepted[0]!;
          const readOnly = accepted[1]!;
          const managed = accepted[2]!;
          const rejected = [
            { ...scratch, environmentTemplate: "unknown-template" },
            { ...scratch, unknown: true },
            Object.fromEntries(
              Object.entries(scratch).filter(([key]) => key !== "taskId"),
            ),
            { ...readOnly, repositorySnapshotId: null },
            { ...readOnly, repositoryBindingVersion: 0 },
            { ...readOnly, providerRepositoryId: "0" },
            { ...readOnly, baseRevision: "" },
            { ...scratch, ...REPOSITORY },
            {
              ...readOnly,
              baseBranch: "main",
              generatedBranch: "rooms/not-read-only",
            },
            { ...readOnly, workKind: "code" },
            { ...managed, workKind: "writing" },
            { ...readOnly, objectFormat: "sha256" },
            { ...readOnly, baseRevision: "a".repeat(64) },
          ];
          for (const [index, body] of rejected.entries()) {
            const uniqueBody: Record<string, unknown> = {
              ...body,
              ...launchIdentity(100 + index),
            };
            if (!("taskId" in body)) delete uniqueBody.taskId;
            const response = await postLaunch(
              harness.serverUrl,
              uuid(100 + index),
              uniqueBody,
            );
            expect(
              response.status,
              `rejected decoder variant ${index + 1}`,
            ).toBe(400);
          }
          console.log("GW03_S0_CASE_1 pass strict_decoder_matrix");

          // Case 2: provision the real scratch Primary before asking the real
          // synthetic provider process to perform the required in-root write.
          diagnoseProvisionError = true;
          await harness.startDaemon();
          console.log(
            `GW03_S0_HOST_DIAGNOSTIC ${JSON.stringify({
              hosts: listPublicHosts(harness.db).map((host) => ({
                id: host.id,
                type: host.type,
                destroyedAt: host.destroyedAt,
              })),
              latestSession: getLatestSessionForHost(harness.db, {
                hostId: harness.hostId,
              }),
            })}`,
          );
          const bindingId = uuid(200);
          const scratchLaunch = {
            ...launchIdentity(200),
            environmentTemplate: "isolated-scratch",
            workKind: "writing",
          };
          const repoHeadBefore = (
            await runGit({ cwd: harness.repoDir, args: ["rev-parse", "HEAD"] })
          ).trim();
          const ready = await waitForReadyLaunch(
            harness.serverUrl,
            bindingId,
            scratchLaunch,
          );
          const environment = await getEnvironment(
            harness.api,
            ready.environmentId,
          );
          expect(environment.status).toBe("ready");
          expect(environment.isGitRepo).toBe(false);
          expect(environment.isWorktree).toBe(false);
          expect(environment.branchName).toBeNull();
          expect(environment.baseBranch).toBeNull();
          expect(repositoryLookupCount).toBe(0);
          for (const key of CREDENTIAL_ENV_KEYS) {
            expect(
              process.env[key],
              `${key} must remain absent`,
            ).toBeUndefined();
          }
          const workspacePath = environment.path;
          if (!workspacePath) {
            throw new Error("Scratch environment has no workspace path");
          }
          await expect(
            fs.lstat(path.join(workspacePath, ".git")),
          ).rejects.toMatchObject({ code: "ENOENT" });
          expect(
            (
              await runGit({
                cwd: harness.repoDir,
                args: ["rev-parse", "HEAD"],
              })
            ).trim(),
          ).toBe(repoHeadBefore);

          const bootstrapResponse = await fetch(
            `${harness.serverUrl}/api/bb-rooms/v1/rooms/${bindingId}/bootstrap`,
          );
          expect(bootstrapResponse.status).toBe(200);
          const bootstrap = await bootstrapResponse.json();
          expect(JSON.stringify(bootstrap)).not.toContain("branch.publish");

          const writePath = path.join(workspacePath, "gw03-primary-write.txt");
          await runSyntheticFilesystemAction({
            api: harness.api,
            threadId: ready.primaryThreadId,
            receiptPath: path.join(workspacePath, "gw03-write-receipt.json"),
            expectedOk: true,
            action: {
              operation: "write",
              path: writePath,
              content: "candidate-ok\n",
            },
          });
          expect(await fs.readFile(writePath, "utf8")).toBe("candidate-ok\n");

          const outsideTarget = path.join(
            harness.daemonDataDir,
            "gw03-outside-target.txt",
          );
          await fs.writeFile(outsideTarget, "outside-sentinel\n", "utf8");
          const attacks: Array<{
            name: string;
            targetPath: string;
            prepare?: () => Promise<void>;
          }> = [
            { name: "absolute", targetPath: outsideTarget },
            {
              name: "parent",
              targetPath: path.relative(workspacePath, outsideTarget),
            },
            {
              name: "symlink",
              targetPath: path.join(workspacePath, "gw03-outside-link"),
              prepare: async () => {
                await fs.symlink(
                  outsideTarget,
                  path.join(workspacePath, "gw03-outside-link"),
                );
              },
            },
            {
              name: "git-dir",
              targetPath: path.join(workspacePath, ".git", "config"),
              prepare: async () => {
                await fs.mkdir(path.join(workspacePath, ".git"));
              },
            },
          ];
          for (const [index, attack] of attacks.entries()) {
            await attack.prepare?.();
            await runSyntheticFilesystemAction({
              api: harness.api,
              threadId: ready.primaryThreadId,
              receiptPath: path.join(
                workspacePath,
                `gw03-attack-${index}-receipt.json`,
              ),
              expectedOk: false,
              action: {
                operation: "write",
                path: attack.targetPath,
                content: `${attack.name}-changed\n`,
              },
            });
          }
          expect(await fs.readFile(outsideTarget, "utf8")).toBe(
            "outside-sentinel\n",
          );

          console.log("GW03_S0_CASE_2 pass isolated_scratch_primary");

          // Case 3 begins with a credential-free synthetic GitHub-id adapter
          // and the real host repository-resolution/provisioning path.
          await runGit({
            cwd: harness.repoDir,
            args: [
              "remote",
              "add",
              "origin",
              "https://github.com/gw03/synthetic-repo.git",
            ],
          });
          await createProject(harness.api, {
            name: "GW03 Synthetic Repository",
            source: {
              type: "local_path",
              hostId: harness.hostId,
              path: harness.repoDir,
            },
          });
          await fs.symlink(
            outsideTarget,
            path.join(harness.repoDir, "gw03-detached-outside-link"),
          );
          await runGit({
            cwd: harness.repoDir,
            args: ["add", "gw03-detached-outside-link"],
          });
          await runGit({
            cwd: harness.repoDir,
            args: ["commit", "-m", "Add detached escape fixture"],
          });
          const requestedRevision = (
            await runGit({ cwd: harness.repoDir, args: ["rev-parse", "HEAD"] })
          ).trim();
          await fs.writeFile(
            path.join(harness.repoDir, "branch-moved.txt"),
            "branch moved after requested revision\n",
            "utf8",
          );
          await runGit({
            cwd: harness.repoDir,
            args: ["add", "branch-moved.txt"],
          });
          await runGit({
            cwd: harness.repoDir,
            args: ["commit", "-m", "Move source branch"],
          });
          const readOnlyLaunch = {
            ...launchIdentity(300),
            ...REPOSITORY,
            baseRevision: requestedRevision,
            environmentTemplate: "detached-read-only",
            workKind: "research",
          };
          const readOnlyReady = await waitForReadyLaunch(
            harness.serverUrl,
            uuid(300),
            readOnlyLaunch,
          );
          const readOnlyEnvironment = await getEnvironment(
            harness.api,
            readOnlyReady.environmentId,
          );
          if (!readOnlyEnvironment.path) {
            throw new Error("Detached read-only environment has no path");
          }
          expect(readOnlyEnvironment.status).toBe("ready");
          expect(readOnlyEnvironment.isGitRepo).toBe(true);
          expect(readOnlyEnvironment.isWorktree).toBe(true);
          expect(
            (
              await runGit({
                cwd: readOnlyEnvironment.path,
                args: ["rev-parse", "HEAD"],
              })
            ).trim(),
          ).toBe(requestedRevision);
          const detachedSymbolicRef = await execFile(
            "git",
            ["symbolic-ref", "-q", "HEAD"],
            { cwd: readOnlyEnvironment.path, encoding: "utf8" },
          ).catch((error: unknown) => error);
          expect(detachedSymbolicRef).toBeInstanceOf(Error);

          const outputPath = resolveDetachedReadOnlyOutputPath({
            dataDir: harness.daemonDataDir,
            environmentId: readOnlyReady.environmentId,
          });
          const copiedReadPath = path.join(outputPath, "alpha-copy.txt");
          await runSyntheticFilesystemAction({
            api: harness.api,
            threadId: readOnlyReady.primaryThreadId,
            receiptPath: path.join(outputPath, "gw03-copy-receipt.json"),
            expectedOk: true,
            action: {
              operation: "copy",
              sourcePath: path.join(readOnlyEnvironment.path, "alpha.txt"),
              targetPath: copiedReadPath,
            },
          });
          expect(await fs.readFile(copiedReadPath, "utf8")).toBe("alpha\n");
          const outputWritePath = path.join(
            outputPath,
            "gw03-output-write.txt",
          );
          await runSyntheticFilesystemAction({
            api: harness.api,
            threadId: readOnlyReady.primaryThreadId,
            receiptPath: path.join(outputPath, "gw03-output-receipt.json"),
            expectedOk: true,
            action: {
              operation: "write",
              path: outputWritePath,
              content: "output-ok\n",
            },
          });
          expect(await fs.readFile(outputWritePath, "utf8")).toBe(
            "output-ok\n",
          );

          const readOnlyAttacks = [
            path.join(readOnlyEnvironment.path, "alpha.txt"),
            outsideTarget,
            path.relative(readOnlyEnvironment.path, outsideTarget),
            path.join(readOnlyEnvironment.path, "gw03-detached-outside-link"),
            path.join(readOnlyEnvironment.path, ".git", "config"),
          ];
          for (const [index, targetPath] of readOnlyAttacks.entries()) {
            await runSyntheticFilesystemAction({
              api: harness.api,
              threadId: readOnlyReady.primaryThreadId,
              receiptPath: path.join(
                outputPath,
                `gw03-read-only-attack-${index}-receipt.json`,
              ),
              expectedOk: false,
              action: {
                operation: "write",
                path: targetPath,
                content: `read-only-attack-${index}\n`,
              },
            });
          }
          expect(
            await fs.readFile(
              path.join(readOnlyEnvironment.path, "alpha.txt"),
              "utf8",
            ),
          ).toBe("alpha\n");
          expect(await fs.readFile(outsideTarget, "utf8")).toBe(
            "outside-sentinel\n",
          );

          const alphaPath = path.join(readOnlyEnvironment.path, "alpha.txt");
          const repositorySnapshotBefore = {
            mode: (await fs.stat(alphaPath)).mode & 0o777,
            index: await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["ls-files", "--stage"],
            }),
            objects: await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["count-objects", "-v"],
            }),
            refs: await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["show-ref"],
            }),
            head: await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["rev-parse", "HEAD"],
            }),
            branches: await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["branch", "--format=%(refname)"],
            }),
            status: await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["status", "--porcelain=v1"],
            }),
          };
          const mutationCommands: Array<
            Extract<SyntheticFilesystemAction, { operation: "exec" }>
          > = [
            {
              operation: "exec",
              executable: "chmod",
              cwd: readOnlyEnvironment.path,
              args: ["+x", "alpha.txt"],
            },
            {
              operation: "exec",
              executable: "git",
              cwd: readOnlyEnvironment.path,
              args: ["update-index", "--chmod=+x", "alpha.txt"],
            },
            {
              operation: "exec",
              executable: "git",
              cwd: readOnlyEnvironment.path,
              args: ["hash-object", "-w", "--stdin"],
              stdin: "gw03-object-mutation\n",
            },
            {
              operation: "exec",
              executable: "git",
              cwd: readOnlyEnvironment.path,
              args: ["update-ref", "refs/heads/gw03-ref-mutation", "HEAD"],
            },
            {
              operation: "exec",
              executable: "git",
              cwd: readOnlyEnvironment.path,
              args: ["commit", "--allow-empty", "-m", "forbidden commit"],
            },
            {
              operation: "exec",
              executable: "git",
              cwd: readOnlyEnvironment.path,
              args: ["branch", "gw03-branch-mutation"],
            },
          ];
          for (const [index, action] of mutationCommands.entries()) {
            await runSyntheticMutationCommand({
              api: harness.api,
              threadId: readOnlyReady.primaryThreadId,
              receiptPath: path.join(
                outputPath,
                `gw03-git-mutation-${index}-receipt.json`,
              ),
              action,
            });
          }
          expect((await fs.stat(alphaPath)).mode & 0o777).toBe(
            repositorySnapshotBefore.mode,
          );
          expect(
            await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["ls-files", "--stage"],
            }),
          ).toBe(repositorySnapshotBefore.index);
          expect(
            await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["count-objects", "-v"],
            }),
          ).toBe(repositorySnapshotBefore.objects);
          expect(
            await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["show-ref"],
            }),
          ).toBe(repositorySnapshotBefore.refs);
          expect(
            await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["rev-parse", "HEAD"],
            }),
          ).toBe(repositorySnapshotBefore.head);
          expect(
            await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["branch", "--format=%(refname)"],
            }),
          ).toBe(repositorySnapshotBefore.branches);
          expect(
            await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["status", "--porcelain=v1"],
            }),
          ).toBe(repositorySnapshotBefore.status);
          const readOnlyBootstrapResponse = await fetch(
            `${harness.serverUrl}/api/bb-rooms/v1/rooms/${uuid(300)}/bootstrap`,
          );
          expect(readOnlyBootstrapResponse.status).toBe(200);
          expect(
            JSON.stringify(await readOnlyBootstrapResponse.json()),
          ).not.toContain("branch.publish");
          console.log("GW03_S0_CASE_3 pass detached_read_only_primary");

          // Case 4: preserve the registered-repository writable worktree and
          // owner-only publish capability without executing a push.
          const managedRevision = (
            await runGit({ cwd: harness.repoDir, args: ["rev-parse", "HEAD"] })
          ).trim();
          const managedBranch = "rooms/gw03-managed";
          const managedReady = await waitForReadyLaunch(
            harness.serverUrl,
            uuid(400),
            {
              ...launchIdentity(400),
              ...REPOSITORY,
              baseRevision: managedRevision,
              environmentTemplate: "managed-worktree",
              workKind: "code",
              baseBranch: "main",
              generatedBranch: managedBranch,
            },
          );
          const managedEnvironment = await getEnvironment(
            harness.api,
            managedReady.environmentId,
          );
          if (!managedEnvironment.path) {
            throw new Error("Managed environment has no path");
          }
          expect(managedEnvironment.status).toBe("ready");
          expect(managedEnvironment.isGitRepo).toBe(true);
          expect(managedEnvironment.isWorktree).toBe(true);
          expect(managedEnvironment.branchName).toBe(managedBranch);
          expect(managedEnvironment.baseBranch).toBe("main");
          const managedWritePath = path.join(
            managedEnvironment.path,
            "gw03-managed-write.txt",
          );
          await runSyntheticFilesystemAction({
            api: harness.api,
            threadId: managedReady.primaryThreadId,
            receiptPath: path.join(
              managedEnvironment.path,
              "gw03-managed-write-receipt.json",
            ),
            expectedOk: true,
            action: {
              operation: "write",
              path: managedWritePath,
              content: "managed-ok\n",
            },
          });
          expect(await fs.readFile(managedWritePath, "utf8")).toBe(
            "managed-ok\n",
          );
          const managedBootstrapResponse = await fetch(
            `${harness.serverUrl}/api/bb-rooms/v1/rooms/${uuid(400)}/bootstrap`,
          );
          expect(managedBootstrapResponse.status).toBe(200);
          expect(
            JSON.stringify(await managedBootstrapResponse.json()),
          ).toContain("branch.publish");
          console.log("GW03_S0_CASE_4 pass managed_worktree_regression");

          // Case 5: the Primary provider itself performs the public create
          // request under its verified agent identity. The ordinary thread
          // create service and Room fence bind each direct child to the exact
          // reserved environment before the child's provider starts.
          const scratchPrimary = await getThread(
            harness.api,
            ready.primaryThreadId,
          );
          const readOnlyPrimary = await getThread(
            harness.api,
            readOnlyReady.primaryThreadId,
          );
          const managedPrimary = await getThread(
            harness.api,
            managedReady.primaryThreadId,
          );
          for (const primary of [
            scratchPrimary,
            readOnlyPrimary,
            managedPrimary,
          ]) {
            agentThreadIds.add(primary.id);
          }

          const scratchChild = await runSyntheticChildSpawn({
            api: harness.api,
            parentThreadId: scratchPrimary.id,
            projectId: scratchPrimary.projectId,
            providerId: scratchPrimary.providerId,
            receiptPath: path.join(
              workspacePath,
              "gw03-scratch-child-create.json",
            ),
          });
          const scratchChildThread = await getThread(
            harness.api,
            scratchChild.id,
          );
          expect(scratchChildThread).toMatchObject({
            parentThreadId: scratchPrimary.id,
            projectId: scratchPrimary.projectId,
            environmentId: scratchPrimary.environmentId,
          });
          expect(scratchChild.environmentId).toBe(ready.environmentId);
          const scratchChildEnvironment = await getEnvironment(
            harness.api,
            scratchChild.environmentId!,
          );
          expect(scratchChildEnvironment.workspaceProvisionType).toBe(
            "isolated-scratch",
          );
          expect(scratchChildEnvironment.isGitRepo).toBe(false);
          expect(scratchChildEnvironment.branchName).toBeNull();
          const scratchChildWrite = path.join(
            workspacePath,
            "gw03-subagent-write.txt",
          );
          await runSyntheticFilesystemAction({
            api: harness.api,
            threadId: scratchChild.id,
            receiptPath: path.join(
              workspacePath,
              "gw03-subagent-write-receipt.json",
            ),
            expectedOk: true,
            action: {
              operation: "write",
              path: scratchChildWrite,
              content: "scratch-subagent-ok\n",
            },
          });
          expect(await fs.readFile(scratchChildWrite, "utf8")).toBe(
            "scratch-subagent-ok\n",
          );
          for (const [index, attack] of attacks.entries()) {
            await runSyntheticFilesystemAction({
              api: harness.api,
              threadId: scratchChild.id,
              receiptPath: path.join(
                workspacePath,
                `gw03-subagent-attack-${index}-receipt.json`,
              ),
              expectedOk: false,
              action: {
                operation: "write",
                path: attack.targetPath,
                content: `scratch-subagent-attack-${index}\n`,
              },
            });
          }
          expect(await fs.readFile(outsideTarget, "utf8")).toBe(
            "outside-sentinel\n",
          );

          const readOnlyChild = await runSyntheticChildSpawn({
            api: harness.api,
            parentThreadId: readOnlyPrimary.id,
            projectId: readOnlyPrimary.projectId,
            providerId: readOnlyPrimary.providerId,
            receiptPath: path.join(
              outputPath,
              "gw03-read-only-child-create.json",
            ),
          });
          const readOnlyChildThread = await getThread(
            harness.api,
            readOnlyChild.id,
          );
          expect(readOnlyChildThread).toMatchObject({
            parentThreadId: readOnlyPrimary.id,
            projectId: readOnlyPrimary.projectId,
            environmentId: readOnlyPrimary.environmentId,
          });
          expect(readOnlyChild.environmentId).toBe(readOnlyReady.environmentId);
          const readOnlyChildEnvironment = await getEnvironment(
            harness.api,
            readOnlyChild.environmentId!,
          );
          expect(readOnlyChildEnvironment.workspaceProvisionType).toBe(
            "detached-read-only",
          );
          expect(
            (
              await runGit({
                cwd: readOnlyChildEnvironment.path!,
                args: ["rev-parse", "HEAD"],
              })
            ).trim(),
          ).toBe(requestedRevision);
          const readOnlyChildCopy = path.join(
            outputPath,
            "gw03-subagent-alpha-copy.txt",
          );
          await runSyntheticFilesystemAction({
            api: harness.api,
            threadId: readOnlyChild.id,
            receiptPath: path.join(
              outputPath,
              "gw03-subagent-copy-receipt.json",
            ),
            expectedOk: true,
            action: {
              operation: "copy",
              sourcePath: path.join(readOnlyEnvironment.path, "alpha.txt"),
              targetPath: readOnlyChildCopy,
            },
          });
          expect(await fs.readFile(readOnlyChildCopy, "utf8")).toBe("alpha\n");
          for (const [index, targetPath] of readOnlyAttacks.entries()) {
            await runSyntheticFilesystemAction({
              api: harness.api,
              threadId: readOnlyChild.id,
              receiptPath: path.join(
                outputPath,
                `gw03-read-only-subagent-attack-${index}-receipt.json`,
              ),
              expectedOk: false,
              action: {
                operation: "write",
                path: targetPath,
                content: `read-only-subagent-attack-${index}\n`,
              },
            });
          }
          for (const [index, action] of mutationCommands.entries()) {
            await runSyntheticMutationCommand({
              api: harness.api,
              threadId: readOnlyChild.id,
              receiptPath: path.join(
                outputPath,
                `gw03-subagent-git-mutation-${index}-receipt.json`,
              ),
              action,
            });
          }
          expect(
            await runGit({
              cwd: readOnlyEnvironment.path,
              args: ["rev-parse", "HEAD"],
            }),
          ).toBe(repositorySnapshotBefore.head);

          const managedChild = await runSyntheticChildSpawn({
            api: harness.api,
            parentThreadId: managedPrimary.id,
            projectId: managedPrimary.projectId,
            providerId: managedPrimary.providerId,
            receiptPath: path.join(
              managedEnvironment.path,
              "gw03-managed-child-create.json",
            ),
          });
          const managedChildThread = await getThread(
            harness.api,
            managedChild.id,
          );
          expect(managedChildThread).toMatchObject({
            parentThreadId: managedPrimary.id,
            projectId: managedPrimary.projectId,
            environmentId: managedPrimary.environmentId,
          });
          expect(managedChild.environmentId).toBe(managedReady.environmentId);
          const managedChildEnvironment = await getEnvironment(
            harness.api,
            managedChild.environmentId!,
          );
          expect(managedChildEnvironment.workspaceProvisionType).toBe(
            "managed-worktree",
          );
          expect(managedChildEnvironment.branchName).toBe(managedBranch);
          expect(
            (
              await runGit({
                cwd: managedChildEnvironment.path!,
                args: ["rev-parse", "HEAD"],
              })
            ).trim(),
          ).toBe(managedRevision);
          const managedChildWrite = path.join(
            managedEnvironment.path,
            "gw03-managed-subagent-write.txt",
          );
          await runSyntheticFilesystemAction({
            api: harness.api,
            threadId: managedChild.id,
            receiptPath: path.join(
              managedEnvironment.path,
              "gw03-managed-subagent-write-receipt.json",
            ),
            expectedOk: true,
            action: {
              operation: "write",
              path: managedChildWrite,
              content: "managed-subagent-ok\n",
            },
          });
          expect(await fs.readFile(managedChildWrite, "utf8")).toBe(
            "managed-subagent-ok\n",
          );
          await runSyntheticFilesystemAction({
            api: harness.api,
            threadId: managedChild.id,
            receiptPath: path.join(
              managedEnvironment.path,
              "gw03-managed-subagent-outside-receipt.json",
            ),
            expectedOk: false,
            action: {
              operation: "write",
              path: outsideTarget,
              content: "managed-subagent-outside\n",
            },
          });
          expect(await fs.readFile(outsideTarget, "utf8")).toBe(
            "outside-sentinel\n",
          );
          const reconciledBootstraps = await Promise.all(
            [bindingId, uuid(300), uuid(400)].map((roomBindingId) =>
              fetch(
                `${harness.serverUrl}/api/bb-rooms/v1/rooms/${roomBindingId}/bootstrap`,
              ),
            ),
          );
          for (const response of reconciledBootstraps) {
            expect(response.status).toBe(200);
          }
          expect(
            attachments.map((attachment) => ({
              childThreadId: attachment.childThreadId,
              parentThreadId: attachment.parentThreadId,
            })),
          ).toEqual(
            expect.arrayContaining([
              {
                childThreadId: scratchChild.id,
                parentThreadId: scratchPrimary.id,
              },
              {
                childThreadId: readOnlyChild.id,
                parentThreadId: readOnlyPrimary.id,
              },
              {
                childThreadId: managedChild.id,
                parentThreadId: managedPrimary.id,
              },
            ]),
          );
          console.log("GW03_S0_CASE_5 pass direct_subagent_fence");

          // Case 6: drive the remaining bypass classes as real processes in
          // each Primary/Subagent sandbox. Environment expansion and PATH
          // lookup deliberately happen after the provider-side path parser,
          // so the read-only bwrap root remains the enforcing boundary.
          const profileActors = [
            {
              name: "scratch-primary",
              threadId: scratchPrimary.id,
              cwd: workspacePath,
              receiptRoot: workspacePath,
            },
            {
              name: "scratch-subagent",
              threadId: scratchChild.id,
              cwd: workspacePath,
              receiptRoot: workspacePath,
            },
            {
              name: "read-only-primary",
              threadId: readOnlyPrimary.id,
              cwd: readOnlyEnvironment.path,
              receiptRoot: outputPath,
            },
            {
              name: "read-only-subagent",
              threadId: readOnlyChild.id,
              cwd: readOnlyEnvironment.path,
              receiptRoot: outputPath,
            },
            {
              name: "managed-primary",
              threadId: managedPrimary.id,
              cwd: managedEnvironment.path,
              receiptRoot: managedEnvironment.path,
            },
            {
              name: "managed-subagent",
              threadId: managedChild.id,
              cwd: managedEnvironment.path,
              receiptRoot: managedEnvironment.path,
            },
          ] as const;
          for (const actor of profileActors) {
            for (const vector of [
              "environment_variable",
              "tool_path_alias",
            ] as const) {
              await runSyntheticEscapeCommand({
                api: harness.api,
                threadId: actor.threadId,
                receiptPath: path.join(
                  actor.receiptRoot,
                  `gw03-${actor.name}-${vector}-receipt.json`,
                ),
                action: {
                  operation: "escape_exec",
                  vector,
                  cwd: actor.cwd,
                  targetPath: outsideTarget,
                  content: `${actor.name}-${vector}-changed\n`,
                },
              });
              expect(await fs.readFile(outsideTarget, "utf8")).toBe(
                "outside-sentinel\n",
              );
            }

            const alternateWorktreePath = path.join(
              harness.daemonDataDir,
              `gw03-alternate-worktree-${actor.name}`,
            );
            await runSyntheticMutationCommand({
              api: harness.api,
              threadId: actor.threadId,
              receiptPath: path.join(
                actor.receiptRoot,
                `gw03-${actor.name}-alternate-worktree-receipt.json`,
              ),
              action: {
                operation: "exec",
                executable: "git",
                cwd: actor.cwd,
                args: [
                  "worktree",
                  "add",
                  "--detach",
                  alternateWorktreePath,
                  "HEAD",
                ],
              },
            });
            await expect(fs.lstat(alternateWorktreePath)).rejects.toMatchObject(
              { code: "ENOENT" },
            );
          }

          const [scratchProjection, readOnlyProjection, managedProjection] =
            await Promise.all(
              reconciledBootstraps.map((response) => response.json()),
            );
          expect(JSON.stringify(scratchProjection)).not.toContain(
            "branch.publish",
          );
          expect(JSON.stringify(readOnlyProjection)).not.toContain(
            "branch.publish",
          );
          expect(JSON.stringify(managedProjection)).toContain("branch.publish");
          for (const projection of [
            scratchProjection,
            readOnlyProjection,
            managedProjection,
          ]) {
            if (
              typeof projection !== "object" ||
              projection === null ||
              !("subagents" in projection) ||
              !Array.isArray(projection.subagents)
            ) {
              throw new Error("Room bootstrap has no Subagent projection");
            }
            expect(projection.subagents).toHaveLength(1);
            for (const subagent of projection.subagents) {
              expect(JSON.stringify(subagent)).not.toContain("branch.publish");
            }
          }
          console.log("GW03_S0_CASE_6 pass escape_and_capability_attacks");

          // Case 7: exercise the public Room command transport against the
          // already-accepted durable result implementation. Invalid commands
          // use fresh request ids so the later revision proves they consumed
          // neither a receipt nor a result revision.
          const scratchResult = workResultSubmission(
            "writing",
            "Scratch Primary result.",
          );
          const readOnlyResult = {
            ...workResultSubmission("research", "Read-only Primary result."),
            sourceRefs: [
              {
                kind: "repository_object",
                repositorySnapshotId: REPOSITORY.repositorySnapshotId,
                objectFormat: "sha1",
                revision: requestedRevision,
                path: "alpha.txt",
              },
            ],
          };
          const managedResult = {
            ...workResultSubmission("code", "Managed Primary result."),
            sourceRefs: [
              {
                kind: "repository_object",
                repositorySnapshotId: REPOSITORY.repositorySnapshotId,
                objectFormat: "sha1",
                revision: managedRevision,
                path: "gw03-managed-write.txt",
              },
            ],
            gitEvidence: {
              schemaVersion: 1,
              repositorySnapshotId: REPOSITORY.repositorySnapshotId,
              objectFormat: "sha1",
              branch: {
                name: managedBranch,
                headRevision: managedRevision,
              },
              commits: [
                { revision: managedRevision, title: "Managed result base" },
              ],
              changedFiles: [
                { path: "gw03-managed-write.txt", change: "added" },
              ],
            },
          };
          const resultProfiles = [
            {
              name: "scratch",
              bindingId,
              kind: "writing" as const,
              projection: scratchProjection,
              validSubmission: scratchResult,
              exactRevision: requestedRevision,
            },
            {
              name: "read-only",
              bindingId: uuid(300),
              kind: "research" as const,
              projection: readOnlyProjection,
              validSubmission: readOnlyResult,
              exactRevision: requestedRevision,
            },
            {
              name: "managed",
              bindingId: uuid(400),
              kind: "code" as const,
              projection: managedProjection,
              validSubmission: managedResult,
              exactRevision: managedRevision,
            },
          ];
          let resultRequestSequence = 7_000;
          const nextResultRequestId = () =>
            encodeClientTurnRequestIdNumber({
              value: resultRequestSequence++,
            });

          for (const profile of resultProfiles) {
            const firstRequestId = nextResultRequestId();
            const firstCommand = {
              kind: "result.publish",
              requestId: firstRequestId,
              stream: { kind: "primary" },
              submission: profile.validSubmission,
            };
            const first = await postRoomCommand(
              harness.serverUrl,
              profile.bindingId,
              firstCommand,
            );
            expect(first.status, `${profile.name} first result`).toBe(202);
            const firstReceipt = requireObject(
              first.body,
              `${profile.name} first result receipt`,
            );
            expect(Object.keys(firstReceipt).sort()).toEqual(
              [
                "admissionSequence",
                "commandKind",
                "completedAt",
                "createdAt",
                "outcome",
                "requestId",
                "result",
                "schemaVersion",
                "stream",
              ].sort(),
            );
            expect(firstReceipt).toMatchObject({
              schemaVersion: 2,
              outcome: "accepted",
              requestId: firstRequestId,
              commandKind: "result.publish",
              stream: { kind: "primary" },
              result: {
                disposition: "result-published",
                resultRevision: 1,
                submission: profile.validSubmission,
              },
            });
            const firstResult = requireObject(
              firstReceipt.result,
              `${profile.name} first result`,
            );
            expect(firstResult.resultId).toMatch(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
            );
            expect(firstResult.resultDigest).toMatch(/^[0-9a-f]{64}$/u);
            expect(firstReceipt.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
            expect(firstReceipt.completedAt).toBe(firstReceipt.createdAt);

            const replay = await postRoomCommand(
              harness.serverUrl,
              profile.bindingId,
              firstCommand,
            );
            expect(replay).toEqual({
              status: 200,
              body: { ...firstReceipt, outcome: "already-accepted" },
            });
            const replayReceipt = requireObject(
              replay.body,
              `${profile.name} replay receipt`,
            );
            const replayResult = requireObject(
              replayReceipt.result,
              `${profile.name} replay result`,
            );
            expect(replayResult.resultId).toBe(firstResult.resultId);
            expect(replayResult.resultRevision).toBe(
              firstResult.resultRevision,
            );
            expect(replayResult.resultDigest).toBe(firstResult.resultDigest);

            const subagentAttempt = await postRoomCommand(
              harness.serverUrl,
              profile.bindingId,
              {
                ...firstCommand,
                requestId: nextResultRequestId(),
                stream: {
                  kind: "subagent",
                  id: publicSubagentId(profile.projection),
                },
              },
            );
            expect(
              subagentAttempt.status,
              `${profile.name} Subagent result`,
            ).toBe(404);

            const invalidSubmissions: Array<{
              name: string;
              submission: Record<string, unknown>;
            }> = [];
            if (profile.name !== "managed") {
              invalidSubmissions.push({
                name: "git-evidence",
                submission: {
                  ...profile.validSubmission,
                  gitEvidence: {
                    schemaVersion: 1,
                    repositorySnapshotId: REPOSITORY.repositorySnapshotId,
                    objectFormat: "sha1",
                    branch: {
                      name: managedBranch,
                      headRevision: managedRevision,
                    },
                    commits: [],
                    changedFiles: [],
                  },
                },
              });
            }
            invalidSubmissions.push(
              {
                name: "mismatched-kind",
                submission: {
                  ...profile.validSubmission,
                  kind: profile.kind === "research" ? "writing" : "research",
                },
              },
              {
                name: "mismatched-repository",
                submission: {
                  ...profile.validSubmission,
                  sourceRefs: [
                    {
                      kind: "repository_object",
                      repositorySnapshotId: uuid(990),
                      objectFormat: "sha1",
                      revision: profile.exactRevision,
                    },
                  ],
                },
              },
              {
                name: "oversized-body",
                submission: {
                  ...profile.validSubmission,
                  sourceRefs: Array.from({ length: 100 }, (_, index) => ({
                    kind: "external_url",
                    url: `https://example.com/${profile.name}/${index}/${"x".repeat(1_500)}`,
                  })),
                },
              },
              {
                name: "duplicate-ids",
                submission: {
                  ...profile.validSubmission,
                  decisions: [
                    { id: "duplicate", text: "First." },
                    { id: "duplicate", text: "Second." },
                  ],
                },
              },
              {
                name: "unknown-field",
                submission: {
                  ...profile.validSubmission,
                  unexpected: true,
                },
              },
            );
            for (const invalid of invalidSubmissions) {
              const rejected = await postRoomCommand(
                harness.serverUrl,
                profile.bindingId,
                {
                  kind: "result.publish",
                  requestId: nextResultRequestId(),
                  stream: { kind: "primary" },
                  submission: invalid.submission,
                },
              );
              expect(rejected.status, `${profile.name} ${invalid.name}`).toBe(
                404,
              );
            }

            const conflict = await postRoomCommand(
              harness.serverUrl,
              profile.bindingId,
              {
                ...firstCommand,
                submission: {
                  ...profile.validSubmission,
                  summary: `${profile.name} conflicting result.`,
                },
              },
            );
            expect(conflict).toMatchObject({
              status: 409,
              body: {
                outcome: "rejected",
                reason: "request_identity_conflict",
                requestId: firstRequestId,
              },
            });

            const later = await postRoomCommand(
              harness.serverUrl,
              profile.bindingId,
              {
                ...firstCommand,
                requestId: nextResultRequestId(),
                submission: {
                  ...profile.validSubmission,
                  summary: `${profile.name} later valid result.`,
                },
              },
            );
            expect(later.status, `${profile.name} later result`).toBe(202);
            const laterReceipt = requireObject(
              later.body,
              `${profile.name} later result receipt`,
            );
            const laterResult = requireObject(
              laterReceipt.result,
              `${profile.name} later result`,
            );
            expect(laterResult.resultRevision).toBe(2);
            expect(laterResult.resultId).not.toBe(firstResult.resultId);

            const replayAfterLater = await postRoomCommand(
              harness.serverUrl,
              profile.bindingId,
              firstCommand,
            );
            expect(replayAfterLater).toEqual(replay);
          }
          console.log("GW03_S0_CASE_7 pass typed_results");

          // Case 8: begin a fresh launch in each profile, crash the daemon
          // after the durable provisioning response, restart, and replay the
          // exact launch. The original Rooms remain live for case 9 while
          // these recovery Rooms exercise profile-specific close cleanup.
          const recoveryProfiles = [
            {
              name: "scratch",
              bindingId: uuid(500),
              launch: {
                ...launchIdentity(500),
                environmentTemplate: "isolated-scratch",
                workKind: "writing",
              },
              template: "isolated-scratch",
            },
            {
              name: "read-only",
              bindingId: uuid(600),
              launch: {
                ...launchIdentity(600),
                ...REPOSITORY,
                baseRevision: requestedRevision,
                environmentTemplate: "detached-read-only",
                workKind: "research",
              },
              template: "detached-read-only",
            },
            {
              name: "managed",
              bindingId: uuid(700),
              launch: {
                ...launchIdentity(700),
                ...REPOSITORY,
                baseRevision: managedRevision,
                environmentTemplate: "managed-worktree",
                workKind: "code",
                baseBranch: "main",
                generatedBranch: "rooms/gw03-recovery-700",
              },
              template: "managed-worktree",
            },
          ] as const;

          for (const profile of recoveryProfiles) {
            const interruptedResponse = await postLaunch(
              harness.serverUrl,
              profile.bindingId,
              profile.launch,
            );
            expect(
              interruptedResponse.status,
              `${profile.name} initial provisioning response`,
            ).toBe(202);
            const interrupted = requireObject(
              await interruptedResponse.json(),
              `${profile.name} initial provisioning payload`,
            );
            expect(interrupted.state).toBe("provisioning");
            if (
              typeof interrupted.environmentId !== "string" ||
              typeof interrupted.primaryThreadId !== "string" ||
              typeof interrupted.projectId !== "string"
            ) {
              throw new Error(
                `${profile.name} provisioning identities are malformed`,
              );
            }
            const durableIdentity = {
              environmentId: interrupted.environmentId,
              primaryThreadId: interrupted.primaryThreadId,
              projectId: interrupted.projectId,
            };

            await harness.crashDaemon();
            await harness.startDaemon();
            const recovered = await waitForReadyLaunch(
              harness.serverUrl,
              profile.bindingId,
              profile.launch,
            );
            expect(recovered).toEqual(durableIdentity);

            const firstReplayResponse = await postLaunch(
              harness.serverUrl,
              profile.bindingId,
              profile.launch,
            );
            expect(firstReplayResponse.status).toBe(200);
            const firstReplay = await firstReplayResponse.json();
            expect(firstReplay).toMatchObject({
              ...durableIdentity,
              bindingId: profile.bindingId,
              state: "ready",
              failureReason: null,
            });
            const secondReplayResponse = await postLaunch(
              harness.serverUrl,
              profile.bindingId,
              profile.launch,
            );
            expect(secondReplayResponse.status).toBe(200);
            expect(await secondReplayResponse.json()).toEqual(firstReplay);

            const recoveredEnvironment = await getEnvironment(
              harness.api,
              recovered.environmentId,
            );
            expect(recoveredEnvironment.workspaceProvisionType).toBe(
              profile.template,
            );
            if (profile.template === "isolated-scratch") {
              expect(recoveredEnvironment.isGitRepo).toBe(false);
              expect(recoveredEnvironment.isWorktree).toBe(false);
              expect(recoveredEnvironment.branchName).toBeNull();
            } else if (profile.template === "detached-read-only") {
              expect(recoveredEnvironment.branchName).toBeNull();
              expect(recoveredEnvironment.baseBranch).toBeNull();
            } else {
              expect(recoveredEnvironment.branchName).toBe(
                profile.launch.generatedBranch,
              );
            }
            const recoveredPath = recoveredEnvironment.path;
            await archiveThread(harness.api, recovered.primaryThreadId);
            const destroyed = await waitForEnvironmentStatus(
              harness.api,
              recovered.environmentId,
              "destroyed",
              15_000,
            );
            expect(destroyed.status).toBe("destroyed");
            expect(
              (await getThread(harness.api, recovered.primaryThreadId))
                .archivedAt,
            ).toBeTypeOf("number");
            if (recoveredPath !== null) {
              await expect(fs.lstat(recoveredPath)).rejects.toMatchObject({
                code: "ENOENT",
              });
            }
          }
          console.log("GW03_S0_CASE_8 pass recovery_and_cleanup");

          // Case 9: refresh every live Room after the recovery cycles, then
          // prove both the bootstrap envelope and each public Subagent row are
          // free of private execution facts while advertising only the
          // capabilities supported by their enforced profile.
          const projectionProfiles = [
            {
              name: "scratch",
              bindingId,
              template: "isolated-scratch",
              primaryThreadId: scratchPrimary.id,
              childThreadId: scratchChild.id,
              expectsBranchPublish: false,
            },
            {
              name: "read-only",
              bindingId: uuid(300),
              template: "detached-read-only",
              primaryThreadId: readOnlyPrimary.id,
              childThreadId: readOnlyChild.id,
              expectsBranchPublish: false,
            },
            {
              name: "managed",
              bindingId: uuid(400),
              template: "managed-worktree",
              primaryThreadId: managedPrimary.id,
              childThreadId: managedChild.id,
              expectsBranchPublish: true,
            },
          ] as const;
          const privateThreadIds = projectionProfiles.flatMap((profile) => [
            profile.primaryThreadId,
            profile.childThreadId,
          ]);
          const providerThreadIds = new Set<string>();
          for (const threadId of privateThreadIds) {
            for (const event of await getThreadEvents(harness.api, threadId)) {
              const eventData = requireObject(event.data, "thread event data");
              if (typeof eventData.providerThreadId === "string") {
                providerThreadIds.add(eventData.providerThreadId);
              }
            }
          }
          expect(providerThreadIds.size).toBeGreaterThan(0);
          const forbiddenPaths = [
            workspacePath,
            readOnlyEnvironment.path,
            outputPath,
            managedEnvironment.path,
            harness.repoDir,
            harness.daemonDataDir,
            syntheticGhConfigDir,
          ].filter((value): value is string => typeof value === "string");
          const forbiddenCredentials = [
            SYNTHETIC_AGENT_TOKEN,
            "test-openai-key",
            ...CREDENTIAL_ENV_KEYS,
          ];

          function assertNoPrivateProjectionFacts(
            value: unknown,
            label: string,
          ): void {
            const visit = (current: unknown): void => {
              if (typeof current === "string") {
                for (const privateId of privateThreadIds) {
                  expect(current, `${label} private thread id`).not.toContain(
                    privateId,
                  );
                }
                for (const providerThreadId of providerThreadIds) {
                  expect(
                    current,
                    `${label} provider session`,
                  ).not.toContain(providerThreadId);
                }
                for (const privatePath of forbiddenPaths) {
                  expect(current, `${label} filesystem path`).not.toContain(
                    privatePath,
                  );
                }
                for (const credential of forbiddenCredentials) {
                  expect(current, `${label} credential`).not.toContain(
                    credential,
                  );
                }
                return;
              }
              if (Array.isArray(current)) {
                for (const item of current) visit(item);
                return;
              }
              if (typeof current !== "object" || current === null) return;
              for (const [key, item] of Object.entries(current)) {
                expect(key, `${label} private key`).not.toMatch(
                  /^(?:credential|credentials|filesystemPath|outputPath|path|providerSessionId|providerThreadId|sessionId|sourcePath|workspacePath)$/iu,
                );
                visit(item);
              }
            };
            visit(value);
          }

          for (const profile of projectionProfiles) {
            const response = await fetch(
              `${harness.serverUrl}/api/bb-rooms/v1/rooms/${profile.bindingId}/bootstrap`,
            );
            expect(response.status, `${profile.name} bootstrap`).toBe(200);
            const projection = requireObject(
              await response.json(),
              `${profile.name} bootstrap`,
            );
            assertNoPrivateProjectionFacts(
              projection,
              `${profile.name} bootstrap`,
            );
            const environmentProjection = requireObject(
              projection.environment,
              `${profile.name} environment projection`,
            );
            expect(environmentProjection).toEqual({
              template: profile.template,
              status: "ready",
            });
            expect(projection.capabilities).toEqual(
              expect.arrayContaining(["message.send", "result.publish"]),
            );
            if (!Array.isArray(projection.capabilities)) {
              throw new Error(`${profile.name} capabilities are malformed`);
            }
            expect(projection.capabilities.includes("branch.publish")).toBe(
              profile.expectsBranchPublish,
            );
            if (
              !Array.isArray(projection.subagents) ||
              projection.subagents.length !== 1
            ) {
              throw new Error(`${profile.name} Subagent projection is malformed`);
            }
            const subagent = requireObject(
              projection.subagents[0],
              `${profile.name} Subagent projection`,
            );
            assertNoPrivateProjectionFacts(
              subagent,
              `${profile.name} Subagent projection`,
            );
            expect(subagent.capabilities).toEqual(["message.send"]);
            expect(JSON.stringify(subagent)).not.toContain("branch.publish");
            expect(JSON.stringify(subagent)).not.toContain("result.publish");
          }
          console.log("GW03_S0_CASE_9 pass public_projection");
        },
      );
    } finally {
      for (const key of CREDENTIAL_ENV_KEYS) {
        const value = savedCredentialEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
      if (savedGhConfigDir === undefined) delete process.env.GH_CONFIG_DIR;
      else process.env.GH_CONFIG_DIR = savedGhConfigDir;
      await fs.rm(syntheticGithubRoot, { recursive: true, force: true });
    }
  });
});
