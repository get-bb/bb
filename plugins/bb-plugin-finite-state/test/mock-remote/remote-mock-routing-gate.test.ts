import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { ASSURANCE_STUDIO_ROUTE_PATCHES } from "./as-route-patches.js";
import {
  assertCallableKeysResolved,
  runRouteGeneration,
  validateAssuranceStudioRoutePatches,
} from "./generate-routes.js";
import { createMockRemote, type MockRemoteHarness } from "./server.js";

const MOCK_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const REFERENCE_ROOT = resolve(MOCK_ROOT, "../../docs/Implementation/api-reference");
const GENERATED_ROOT = resolve(MOCK_ROOT, "generated");
const harnesses: MockRemoteHarness[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function createHarness(
  register?: Parameters<typeof createMockRemote>[0]["register"],
): MockRemoteHarness {
  const harness = createMockRemote({
    platformToken: "platform-secret-value",
    assuranceStudioKey: "as-secret-value",
    fixtureRoot: resolve(MOCK_ROOT, "fixtures"),
    register,
  });
  harnesses.push(harness);
  return harness;
}

async function errorCode(response: Response): Promise<string> {
  const body: unknown = await response.json();
  if (
    body === null ||
    typeof body !== "object" ||
    !("error" in body) ||
    body.error === null ||
    typeof body.error !== "object" ||
    !("code" in body.error) ||
    typeof body.error.code !== "string"
  ) {
    throw new Error("Response did not contain a structured mock error");
  }
  return body.error.code;
}

describe("remote-mock-routing-gate", () => {
  it("vendored checksums and generated output are stable", async () => {
    await expect(runRouteGeneration({ check: true })).resolves.toBeUndefined();
    const manifest = await readFile(resolve(GENERATED_ROOT, "source-manifest.json"), "utf8");
    expect(manifest).not.toMatch(/generatedAt|timestamp|20[0-9]{2}-[0-9]{2}-[0-9]{2}T/);
    expect(manifest).toContain('"pathCount": 134');
    expect(manifest).toContain('"pathCount": 80');
  });

  it("platform and AS auth are service-specific and redacted", async () => {
    const harness = createHarness();
    const platformWrong = await harness.platform.fetch("http://mock/public/v0/projects", {
      headers: { "X-API-Key": "as-secret-value" },
    });
    const asWrong = await harness.assuranceStudio.fetch(
      "http://mock/api/projects/project-1/threats",
      { headers: { "X-Authorization": "platform-secret-value" } },
    );
    expect(platformWrong.status).toBe(401);
    expect(asWrong.status).toBe(401);
    const serialized = `${await platformWrong.clone().text()}${await asWrong.clone().text()}`;
    expect(await errorCode(platformWrong)).toBe("MOCK_UNAUTHORIZED");
    expect(await errorCode(asWrong)).toBe("MOCK_UNAUTHORIZED");
    expect(serialized).not.toContain("platform-secret-value");
    expect(serialized).not.toContain("as-secret-value");
  });

  it("handler-audit patch without evidence fails generation", () => {
    const evidence = new Map([
      ["assurance-studio-api-gaps.md", "## 2. Handler audit\nGET /known"],
    ]);
    expect(() =>
      validateAssuranceStudioRoutePatches(
        [{ method: "GET", pathTemplate: "/known" }],
        evidence,
      ),
    ).toThrow("lacks evidence");
    expect(() =>
      validateAssuranceStudioRoutePatches(ASSURANCE_STUDIO_ROUTE_PATCHES, evidence),
    ).toThrow("evidence not found");
  });

  it("duplicate and unknown route registration fail startup", () => {
    expect(() =>
      createHarness((service, registry) => {
        if (service !== "platform") return;
        registry.register("platform:GET:/public/v0/projects", () => Response.json({}));
        registry.register("platform:GET:/public/v0/projects", () => Response.json({}));
      }),
    ).toThrow("Duplicate mock route registration");

    expect(() =>
      createHarness((service, registry) => {
        if (service === "platform") {
          registry.register("platform:GET:/new-openapi-route", () => Response.json({}));
        }
      }),
    ).toThrow("Unknown mock route registration");
  });

  it("literal routes outrank parameter routes at runtime", async () => {
    const harness = createHarness((service, registry) => {
      if (service !== "assurance-studio") return;
      registry.register(
        "assurance-studio:GET:/api/projects/{projectId}/requirements/{requirementId}",
        () => Response.json({ route: "requirement-item" }),
      );
    });
    const response = await harness.assuranceStudio.fetch(
      "http://mock/api/projects/project-1/requirements/traceability",
      { headers: { "X-API-Key": "as-secret-value" } },
    );
    expect(response.status).toBe(501);
    await expect(errorCode(response)).resolves.toBe("MOCK_HANDLER_MISSING");
  });

  it("all supported frozen operations map and unresolved keys fail closed", () => {
    const harness = createHarness((service, registry) => {
      if (service === "platform") {
        registry.register(
          "platform:GET:/public/v0/versions/{projectVersionId}",
          () => Response.json({ findingsSummary: {} }),
        );
        return;
      }
      registry.register(
        "assurance-studio:GET:/api/projects/{projectId}/risks/{riskId}",
        () => Response.json({}),
      );
      registry.register(
        "assurance-studio:PATCH:/api/projects/{projectId}/risks/{riskId}",
        () => Response.json({}),
      );
    });
    expect(harness.platform.routes).toContainEqual(
      expect.objectContaining({
        routeId: "platform:GET:/public/v0/versions/{projectVersionId}",
      }),
    );
    expect(harness.assuranceStudio.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          routeId: "assurance-studio:GET:/api/projects/{projectId}/risks/{riskId}",
        }),
        expect.objectContaining({
          routeId: "assurance-studio:PATCH:/api/projects/{projectId}/risks/{riskId}",
        }),
      ]),
    );
    expect(
      harness.assuranceStudio.routes.some(
        (route) =>
          route.pathTemplate === "/api/projects/{projectId}/assets" &&
          (route.method === "GET" || route.method === "POST"),
      ),
    ).toBe(false);
    expect(() =>
      assertCallableKeysResolved(
        "platform",
        [{ method: "GET", pathTemplate: "/known" }],
        new Set(["GET /known", "GET /missing"]),
      ),
    ).toThrow("GET /missing");
  });

  it("501 known versus 404 unknown versus 415 media and 400 JSON", async () => {
    const harness = createHarness();
    const known = await harness.platform.fetch("http://mock/public/v0/projects", {
      headers: { "X-Authorization": "platform-secret-value" },
    });
    const unknown = await harness.platform.fetch("http://mock/not-a-route", {
      headers: { "X-Authorization": "platform-secret-value" },
    });
    const unsupported = await harness.assuranceStudio.fetch(
      "http://mock/api/projects/project-1/threats",
      {
        method: "POST",
        headers: {
          "X-API-Key": "as-secret-value",
          "Content-Type": "text/plain",
        },
        body: "not json",
      },
    );
    const invalidJson = await harness.assuranceStudio.fetch(
      "http://mock/api/projects/project-1/threats",
      {
        method: "POST",
        headers: {
          "X-API-Key": "as-secret-value",
          "Content-Type": "application/json",
        },
        body: "{",
      },
    );
    expect([known.status, unknown.status, unsupported.status, invalidJson.status]).toEqual([
      501, 404, 415, 400,
    ]);
    await expect(errorCode(known)).resolves.toBe("MOCK_HANDLER_MISSING");
    await expect(errorCode(unknown)).resolves.toBe("MOCK_ROUTE_NOT_FOUND");
    await expect(errorCode(unsupported)).resolves.toBe("MOCK_UNSUPPORTED_MEDIA_TYPE");
    await expect(errorCode(invalidJson)).resolves.toBe("MOCK_INVALID_JSON");
  });

  it("route growth does not expand the frozen callable registry", () => {
    const harness = createHarness();
    expect(harness.platform.routes.some((route) => route.pathTemplate === "/public/v0/projects/archive")).toBe(false);
    expect(
      harness.assuranceStudio.routes.some(
        (route) => route.pathTemplate === "/api/projects/{projectId}/reports",
      ),
    ).toBe(false);
    expect(harness.platform.routes.some((route) => route.pathTemplate === "/public/v0/projects")).toBe(true);
  });

  it("closing AS leaves Platform healthy; closing Platform leaves AS healthy", async () => {
    const harness = createHarness((service, registry) => {
      if (service === "platform") {
        registry.register("platform:GET:/public/v0/projects", () =>
          Response.json({ service }),
        );
      } else {
        registry.register(
          "assurance-studio:GET:/api/projects/{projectId}/threats",
          () => Response.json({ service }),
        );
      }
    });
    const first = await harness.listen();
    await harness.assuranceStudio.close();
    const platformResponse = await fetch(`${first.platformBaseUrl}/public/v0/projects`, {
      headers: { "X-Authorization": "platform-secret-value" },
    });
    expect(platformResponse.status).toBe(200);

    const secondAsUrl = await harness.assuranceStudio.listen();
    await harness.platform.close();
    const asResponse = await fetch(`${secondAsUrl}/api/projects/project-1/threats`, {
      headers: { "X-API-Key": "as-secret-value" },
    });
    expect(asResponse.status).toBe(200);
    await expect(harness.platform.close()).resolves.toBeUndefined();
  });

  it("check mode detects one-byte reference/output drift and writes nothing", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fs-route-check-test-"));
    temporaryRoots.push(root);
    const references = resolve(root, "references");
    const outputs = resolve(root, "outputs");
    await cp(REFERENCE_ROOT, references, { recursive: true });
    await cp(GENERATED_ROOT, outputs, { recursive: true });
    const outputPath = resolve(outputs, "platform-routes.ts");
    const before = await readFile(outputPath, "utf8");
    const beforeMtime = (await stat(outputPath)).mtimeMs;
    await writeFile(outputPath, `${before} `, "utf8");
    const drifted = await readFile(outputPath, "utf8");
    await expect(
      runRouteGeneration({ check: true, referenceRoot: references, outputRoot: outputs }),
    ).rejects.toThrow("output drift");
    expect(await readFile(outputPath, "utf8")).toBe(drifted);
    expect((await stat(outputPath)).mtimeMs).toBeGreaterThanOrEqual(beforeMtime);

    await writeFile(outputPath, before, "utf8");
    const sourcePath = resolve(references, "finite-state-api-v0.3.0.openapi.yaml");
    const source = await readFile(sourcePath, "utf8");
    await writeFile(sourcePath, `${source} `, "utf8");
    await expect(
      runRouteGeneration({ check: true, referenceRoot: references, outputRoot: outputs }),
    ).rejects.toThrow("checksum mismatch");
    expect(await readFile(outputPath, "utf8")).toBe(before);
  });
});
