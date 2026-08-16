import {
  createConnection,
  createProject,
  migrate,
  noopNotifier,
  upsertHost,
  upsertProjectExecutionDefaults,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import { createLiveWorkTogetherRoomResourceRegistry } from "../../src/room-distribution/room-resource-live-registry.js";
import { WorkTogetherRoomProvisioningUnavailableError } from "../../src/room-distribution/room-resource-provisioner.js";

const CANDIDATE_HOST_ID = "893b7804-b485-4763-aaaa-b5be3f3ae34e";
const CC_SANDBOX_GITHUB_ID = "1268425814";
const CC_SANDBOX_PATH = "/srv/work-together/cc-sandbox";

function setupDb() {
  const db = createConnection(":memory:");
  migrate(db);
  return db;
}

describe("live Work Together Room resource registry", () => {
  it("resolves a Ready cc-sandbox binding from the host checkout, not a static pair", async () => {
    const db = setupDb();
    const host = upsertHost(db, noopNotifier, {
      name: "wt-cell",
      type: "persistent",
    });
    const { project } = createProject(db, noopNotifier, {
      name: "cc-sandbox",
      source: {
        type: "local_path",
        hostId: host.id,
        path: CC_SANDBOX_PATH,
      },
    });
    upsertProjectExecutionDefaults(db, {
      projectId: project.id,
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "full",
      serviceTier: "default",
    });

    const resolveGithubRepository = async (args: {
      hostId: string;
      knownPaths: readonly string[];
      providerRepositoryId: string;
    }) => {
      expect(args.hostId).toBe(host.id);
      expect(args.providerRepositoryId).toBe(CC_SANDBOX_GITHUB_ID);
      expect(args.knownPaths).toEqual([CC_SANDBOX_PATH]);
      return {
        outcome: "found" as const,
        repository: {
          path: CC_SANDBOX_PATH,
          name: "cc-sandbox",
        },
      };
    };

    const registry = createLiveWorkTogetherRoomResourceRegistry({
      db,
      resolveGithubRepository,
    });

    await expect(
      registry.resolve({
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: CC_SANDBOX_GITHUB_ID,
      }),
    ).resolves.toEqual({
      bbHostId: host.id,
      providerId: "codex",
      projectName: "cc-sandbox",
      sourcePath: CC_SANDBOX_PATH,
    });
  });

  it("uses the checkout basename and product default provider when no BB project exists", async () => {
    const db = setupDb();
    const host = upsertHost(db, noopNotifier, {
      name: "wt-cell",
      type: "persistent",
    });
    const registry = createLiveWorkTogetherRoomResourceRegistry({
      db,
      resolveGithubRepository: async () => ({
        outcome: "found",
        repository: {
          path: "/home/user/src/new-ready-repo",
          name: "new-ready-repo",
        },
      }),
    });

    await expect(
      registry.resolve({
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: "99",
      }),
    ).resolves.toEqual({
      bbHostId: host.id,
      providerId: "codex",
      projectName: "new-ready-repo",
      sourcePath: "/home/user/src/new-ready-repo",
    });
  });

  it("returns null when the host confirms the repository is not checked out", async () => {
    const db = setupDb();
    upsertHost(db, noopNotifier, {
      name: "wt-cell",
      type: "persistent",
    });
    const registry = createLiveWorkTogetherRoomResourceRegistry({
      db,
      resolveGithubRepository: async () => ({
        outcome: "not_found",
      }),
    });

    await expect(
      registry.resolve({
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: "77",
      }),
    ).resolves.toBeNull();
  });

  it("is unavailable when GitHub identity cannot be resolved", async () => {
    const db = setupDb();
    upsertHost(db, noopNotifier, {
      name: "wt-cell",
      type: "persistent",
    });
    const registry = createLiveWorkTogetherRoomResourceRegistry({
      db,
      resolveGithubRepository: async () => ({
        outcome: "unavailable",
      }),
    });

    await expect(
      registry.resolve({
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: CC_SANDBOX_GITHUB_ID,
      }),
    ).rejects.toBeInstanceOf(WorkTogetherRoomProvisioningUnavailableError);
  });

  it("does not classify an invalid repository id as a confirmed miss", async () => {
    const db = setupDb();
    upsertHost(db, noopNotifier, {
      name: "wt-cell",
      type: "persistent",
    });
    const registry = createLiveWorkTogetherRoomResourceRegistry({
      db,
      resolveGithubRepository: async () => {
        throw new Error("must not ask the host for an invalid identity");
      },
    });

    await expect(
      registry.resolve({
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: "not-a-github-id",
      }),
    ).rejects.toBeInstanceOf(WorkTogetherRoomProvisioningUnavailableError);
  });

  it("is unavailable when the cell has no public host or more than one", async () => {
    const empty = createLiveWorkTogetherRoomResourceRegistry({
      db: setupDb(),
      resolveGithubRepository: async () => {
        throw new Error("must not ask the host without a single public host");
      },
    });
    await expect(
      empty.resolve({
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: CC_SANDBOX_GITHUB_ID,
      }),
    ).rejects.toBeInstanceOf(WorkTogetherRoomProvisioningUnavailableError);

    const db = setupDb();
    upsertHost(db, noopNotifier, { name: "one", type: "persistent" });
    upsertHost(db, noopNotifier, { name: "two", type: "persistent" });
    const many = createLiveWorkTogetherRoomResourceRegistry({
      db,
      resolveGithubRepository: async () => {
        throw new Error("must not ask the host when topology is ambiguous");
      },
    });
    await expect(
      many.resolve({
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: CC_SANDBOX_GITHUB_ID,
      }),
    ).rejects.toBeInstanceOf(WorkTogetherRoomProvisioningUnavailableError);
  });

  it("rethrows host ApiError so HTTP does not collapse it to 503", async () => {
    const db = setupDb();
    upsertHost(db, noopNotifier, {
      name: "wt-cell",
      type: "persistent",
    });
    const registry = createLiveWorkTogetherRoomResourceRegistry({
      db,
      resolveGithubRepository: async () => {
        throw new ApiError(502, "host_unavailable", "Host is not connected");
      },
    });

    await expect(
      registry.resolve({
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: CC_SANDBOX_GITHUB_ID,
      }),
    ).rejects.toMatchObject({
      status: 502,
      body: { code: "host_unavailable" },
    });
  });
});
