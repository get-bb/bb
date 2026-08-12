import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { AssuranceStudioClient } from "../../../lib/remote/assurance-studio/client.js";
import type { AsCreatableEntityKind } from "../../../lib/remote/types.js";
import { createMockRemote, type MockRemoteHarness } from "../server.js";
import { registerMockAssuranceStudio } from "./register.js";
import type { AssuranceStudioState } from "./state.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures", import.meta.url));
const apiKey = "as-test-key";
let harness: MockRemoteHarness | null = null;

function setup() {
  let tick = 0;
  let state: AssuranceStudioState | null = null;
  harness = createMockRemote({
    platformToken: "platform-test-token",
    assuranceStudioKey: apiKey,
    fixtureRoot,
    register(service, registry) {
      if (service === "assurance-studio") {
        state = registerMockAssuranceStudio(registry, fixtureRoot, {
          now: () => `2026-05-12T14:30:${String(tick++).padStart(2, "0")}.000Z`,
        });
      }
    },
  });
  return {
    harness,
    get state() {
      if (state === null) throw new Error("AS state was not registered");
      return state;
    },
    client: new AssuranceStudioClient({
      baseUrl: "http://mock.invalid",
      apiKey,
      fetch: harness.assuranceStudio.fetch,
    }),
  };
}

afterEach(async () => {
  await harness?.close();
  harness = null;
});

describe("mock Assurance Studio CRUD", () => {
  it("preserves page base, review outcome, audit attribution, and head checkpoint", async () => {
    const setupResult = setup();
    const { client } = setupResult;
    const initialHead = setupResult.state.head;
    const pages = [];
    for await (const page of client.listEntities("component", {
      projectId: "project-4a752600a07a",
      page: { pageSize: 5 },
    })) pages.push(page);
    expect(pages.map((page) => page.items.length)).toEqual([5, 5, 2]);
    expect(pages[0]?.items[0]).toMatchObject({
      id: "as-component-01",
      reviewVersion: "9007199254740993",
      reviewStatus: "human_approved",
      humanEdited: true,
    });

    const created = await client.createEntity("threat", {
      projectId: "project-4a752600a07a",
      fields: { title: "Mock threat", reviewStatus: "human_approved" },
    });
    expect(created).toMatchObject({ success: true, reviewStatusSet: true });
    expect(created.entity.reviewStatus).toBe("human_approved");

    const updated = await client.updateEntity("threat", {
      projectId: "project-4a752600a07a",
      id: created.entity.id,
      fields: {
        title: "Reviewed mock threat",
        review_version: created.entity.reviewVersion!,
      },
    });
    expect(updated.entity).toMatchObject({ humanEdited: true, fields: { title: "Reviewed mock threat" } });
    expect(BigInt(updated.entity.reviewVersion!)).toBe(BigInt(created.entity.reviewVersion!) + 1n);
    expect(BigInt(setupResult.state.head.versionId)).toBe(BigInt(initialHead.versionId) + 3n);
    expect(setupResult.state.head.workingHash).not.toBe(initialHead.workingHash);
    expect(setupResult.state.audit("threat", created.entity.id).map((entry) => entry.action)).toEqual([
      "created", "updated", "updated",
    ]);
    expect(setupResult.state.audit("threat", created.entity.id)[0]?.actor).toBe("mock-admin");
  });

  it("returns deletion impact and makes detach differ from cascade", async () => {
    const { client, harness: remote } = setup();
    const blocked = await client.deleteEntity("zone", {
      projectId: "project-4a752600a07a",
      id: "zone-1",
    });
    expect(blocked).toMatchObject({
      success: false,
      impact: { allowedActions: ["detach", "cascade"], recommendedAction: "cascade" },
    });

    await expect(client.deleteEntity("zone", {
      projectId: "project-4a752600a07a",
      id: "zone-1",
      mode: "detach",
    })).resolves.toEqual({ success: true });
    const detachedComponent = await client.getEntity("component", {
      projectId: "project-4a752600a07a",
      id: "as-component-01",
    });
    expect(detachedComponent.fields.zoneId).toBeUndefined();

    await remote.reset("assurance-studio");
    await expect(client.deleteEntity("zone", {
      projectId: "project-4a752600a07a",
      id: "zone-1",
      mode: "cascade",
    })).resolves.toEqual({ success: true });
    await expect(client.getEntity("component", {
      projectId: "project-4a752600a07a",
      id: "as-component-01",
    })).rejects.toMatchObject({ status: 404 });
  });

  it("keeps attack-path create and raw request out of the callable surface", async () => {
    const { harness: remote } = setup();
    expect(remote.assuranceStudio.routes.map((route) => route.routeId)).not.toContain(
      "assurance-studio:POST:/api/projects/{projectId}/attack-paths",
    );
    const response = await remote.assuranceStudio.fetch(
      "http://mock.invalid/api/projects/project-4a752600a07a/attack-paths",
      {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(501);

    // @ts-expect-error attack-path is deliberately excluded from the create contract.
    const impossible: AsCreatableEntityKind = "attack-path";
    expect(impossible).toBe("attack-path");
    expect("asRawApi" in new AssuranceStudioClient({
      baseUrl: "http://mock.invalid",
      apiKey,
      fetch: remote.assuranceStudio.fetch,
    })).toBe(false);
  });
});
