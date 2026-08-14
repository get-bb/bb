import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { ENTITIES } from "../../../lib/sync/registry.js";
import { computePlan } from "../plan/index.js";
import { createSerializer } from "../serialize/serializer.js";
import {
  InvalidAdapterError,
  registerAdapter,
  registerResolver,
  type EntityAdapter,
  type SyncScope,
} from "./adapter.js";
import { status } from "./status.js";

const host = createFakePluginHost({
  pluginId: "finite-state-resolver-scope",
});
const platformScope: SyncScope = {
  projectId: "platform-project-resolver",
  projectVersionId: "platform-version-resolver",
};
const assuranceStudioProjectId = "as-project-resolver";
const resolverScopes: string[] = [];
const fetchScopes: string[] = [];
let root: string;

const key = ENTITIES.reqCheckMap.key({ reqId: "REQ-RESOLVER" });
const adapter: EntityAdapter = {
  kind: "reqCheckMap",
  klass: "OVERLAY",
  serializer: createSerializer("reqCheckMap"),
  async *fetchRemote(scope, progress) {
    fetchScopes.push(scope.projectId);
    progress({ page: 1, of: 1 });
    yield [];
  },
  async readWorking() {
    return [
      {
        key,
        payload: { reqId: "REQ-RESOLVER", checkIds: ["check-static"] },
        file: "product-security/requirements/REQ-RESOLVER.yaml",
      },
    ];
  },
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "fs-resolver-scope-"));
});

afterAll(async () => {
  await host.harness.lifecycle.dispose();
  await rm(root, { recursive: true, force: true });
});

describe("registered overlay resolver scope", () => {
  it("refuses resolver registration for a non-overlay entity", () => {
    expect(() =>
      registerResolver("component", async () => ({ resolved: false })),
    ).toThrow(InvalidAdapterError);
  });

  it("uses the mapped AS scope for status and plan resolvers", async () => {
    registerAdapter(adapter);
    registerResolver("reqCheckMap", async (_key, scope) => {
      resolverScopes.push(scope.projectId);
      return { resolved: true, detail: null };
    });
    const deps = {
      db: createPluginContext(host.bb).db(),
      worktreeRoot: root,
      adapters: [adapter],
      now: () => new Date("2026-08-14T12:00:00.000Z"),
    };
    const binding = { assuranceStudioProjectId };

    await status(deps, platformScope, ["reqCheckMap"], binding);
    await computePlan(deps, platformScope, ["reqCheckMap"], binding);

    expect(fetchScopes).toEqual([
      assuranceStudioProjectId,
      assuranceStudioProjectId,
    ]);
    expect(resolverScopes).toEqual([
      assuranceStudioProjectId,
      assuranceStudioProjectId,
    ]);
  });
});
