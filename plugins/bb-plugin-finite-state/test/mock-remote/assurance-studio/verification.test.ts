import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AssuranceStudioClient } from "../../../lib/remote/assurance-studio/client.js";
import { createMockRemote } from "../server.js";
import { registerMockAssuranceStudio } from "./register.js";

const fixtureRoot = fileURLToPath(new URL("../fixtures", import.meta.url));

describe("mock Assurance Studio verification", () => {
  it("serves only frozen list/get/run operations", async () => {
    const harness = createMockRemote({
      platformToken: "platform-token",
      assuranceStudioKey: "as-key",
      fixtureRoot,
      register(service, registry) {
        if (service === "assurance-studio") registerMockAssuranceStudio(registry, fixtureRoot);
      },
    });
    const client = new AssuranceStudioClient({
      baseUrl: "http://mock.invalid",
      apiKey: "as-key",
      fetch: harness.assuranceStudio.fetch,
    });
    try {
      const pages = [];
      for await (const page of client.listVerificationChecks({
        projectId: "project-4a752600a07a",
        status: "failed",
      })) pages.push(page);
      expect(pages.flatMap((page) => page.items)).toHaveLength(6);
      await expect(client.getVerificationCheck({
        projectId: "project-4a752600a07a",
        checkId: "check-001",
      })).resolves.toMatchObject({ id: "check-001", results: [{ id: "result-1" }] });
      await expect(client.runVerificationChecks({
        projectId: "project-4a752600a07a",
        checkIds: ["check-001", "check-002"],
      })).resolves.toEqual({ runId: "mock-verification-run-1", checksQueued: 1, status: "queued" });
      await harness.reset("assurance-studio");
      await expect(client.runVerificationChecks({
        projectId: "project-4a752600a07a",
        checkIds: ["check-001", "check-002"],
      })).resolves.toEqual({ runId: "mock-verification-run-1", checksQueued: 1, status: "queued" });
      expect(harness.assuranceStudio.routes.map((route) => route.routeId)).not.toContain(
        "assurance-studio:POST:/api/projects/{projectId}/verification/checks",
      );
    } finally {
      client.close();
      await harness.close();
    }
  });
});
