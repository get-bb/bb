import { describe, expect, it } from "vitest";

import {
  loadWorkTogetherRoomResourceRegistry,
  WorkTogetherRoomResourceRegistryConfigError,
} from "../../src/room-distribution/room-resource-registry.js";

const CANDIDATE_HOST_ID = "55555555-5555-4555-8555-555555555555";

function config(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    repositories: [
      {
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: "42",
        bbHostId: "host_23456789ab",
        providerId: "codex",
        projectName: "Work Together Repository",
        sourcePath: "/srv/work-together/repository",
        ...overrides,
      },
    ],
  });
}

describe("Work Together Room resource registry", () => {
  it("resolves only the exact operator-owned candidate/repository pair", () => {
    const registry = loadWorkTogetherRoomResourceRegistry(config());
    expect(registry.configured).toBe(true);
    expect(
      registry.resolve({
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: "42",
      }),
    ).toEqual({
      bbHostId: "host_23456789ab",
      providerId: "codex",
      projectName: "Work Together Repository",
      sourcePath: "/srv/work-together/repository",
    });
    expect(
      registry.resolve({
        candidateHostId: CANDIDATE_HOST_ID,
        providerRepositoryId: "43",
      }),
    ).toBeNull();
  });

  it("keeps an absent configuration disabled and non-resolving", () => {
    for (const raw of [undefined, null, ""] as const) {
      const registry = loadWorkTogetherRoomResourceRegistry(raw);
      expect(registry.configured).toBe(false);
      expect(
        registry.resolve({
          candidateHostId: CANDIDATE_HOST_ID,
          providerRepositoryId: "42",
        }),
      ).toBeNull();
    }
  });

  it.each([
    "not-json",
    '{"schemaVersion":1,"schemaVersion":1,"repositories":[]}',
    JSON.stringify({ schemaVersion: 2, repositories: [] }),
    JSON.stringify({ schemaVersion: 1, repositories: [], extra: true }),
    config({ sourcePath: "relative/path" }),
    config({ sourcePath: "/" }),
    config({ sourcePath: "/srv/../private" }),
    config({ bbHostId: "host_forged" }),
    config({ providerRepositoryId: "github.com/owner/repo" }),
    config({ candidateHostId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }),
    ` ${config()}`,
  ])("rejects ambiguous or unsafe configuration", (raw) => {
    expect(() => loadWorkTogetherRoomResourceRegistry(raw)).toThrow(
      WorkTogetherRoomResourceRegistryConfigError,
    );
  });

  it("rejects duplicate candidate/repository authority", () => {
    const first = JSON.parse(config()) as {
      schemaVersion: number;
      repositories: unknown[];
    };
    expect(() =>
      loadWorkTogetherRoomResourceRegistry(
        JSON.stringify({
          ...first,
          repositories: [...first.repositories, ...first.repositories],
        }),
      ),
    ).toThrow(WorkTogetherRoomResourceRegistryConfigError);
  });
});
