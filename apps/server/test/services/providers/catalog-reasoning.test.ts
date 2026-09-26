import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  hosts,
  migrate,
  replaceStoredProviderModelCatalog,
  type DbConnection,
} from "@bb/db";
import type { AvailableModel } from "@bb/domain";
import { resolveCatalogReasoningLevel } from "../../../src/services/providers/catalog-reasoning.js";

let db: DbConnection;
const args = {
  hostId: "host-fixture",
  providerId: "fixture",
  model: "late-model",
  reasoningLevel: "medium" as const,
  workspacePath: "/fixture",
  catalogScope: "host" as const,
};
const model: AvailableModel = {
  id: "late-model",
  model: "late-model",
  displayName: "Late model",
  description: "",
  supportedReasoningEfforts: [],
  defaultReasoningEffort: "medium",
  isDefault: true,
};

function store(
  models: AvailableModel[],
  selectedOnlyModels: AvailableModel[],
  scopeKey = "",
) {
  replaceStoredProviderModelCatalog(db, {
    row: {
      hostId: args.hostId,
      providerId: args.providerId,
      scopeKey,
      fingerprint: "fixture",
      modelsJson: JSON.stringify(models),
      selectedOnlyModelsJson: JSON.stringify(selectedOnlyModels),
      fetchedAt: Date.now(),
    },
    pruneWorkspaceRowsFetchedBefore: null,
  });
}

describe("catalog reasoning execution", () => {
  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
    db.insert(hosts)
      .values({
        id: args.hostId,
        name: "fixture",
        type: "persistent",
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
  });
  afterEach(() => db.$client.close());

  it.each([false, true])(
    "does not send the stored Medium default for unknown reasoning (selectedOnly=%s)",
    (selectedOnly) => {
      store(selectedOnly ? [] : [model], selectedOnly ? [model] : []);
      expect(resolveCatalogReasoningLevel(db, args)).toBeUndefined();
    },
  );

  it("preserves a real single Medium choice and explicit supported reasoning", () => {
    store(
      [
        {
          ...model,
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Medium" },
            { reasoningEffort: "high", description: "High" },
          ],
        },
      ],
      [],
    );
    expect(resolveCatalogReasoningLevel(db, args)).toBe("medium");
    expect(
      resolveCatalogReasoningLevel(db, { ...args, reasoningLevel: "high" }),
    ).toBe("high");
    store(
      [
        {
          ...model,
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Medium" },
          ],
        },
      ],
      [],
    );
    expect(resolveCatalogReasoningLevel(db, args)).toBe("medium");
  });

  it("uses the correct workspace and host rather than another catalog", () => {
    store([model], [], "/fixture");
    expect(resolveCatalogReasoningLevel(db, args)).toBe("medium");
    expect(
      resolveCatalogReasoningLevel(db, { ...args, catalogScope: "workspace" }),
    ).toBeUndefined();
    expect(
      resolveCatalogReasoningLevel(db, {
        ...args,
        hostId: "other",
        catalogScope: "workspace",
      }),
    ).toBe("medium");
  });

  it("preserves explicit reasoning when no catalog or model is available", () => {
    expect(resolveCatalogReasoningLevel(db, args)).toBe("medium");
    store([], []);
    expect(resolveCatalogReasoningLevel(db, args)).toBe("medium");
  });
});
