// @vitest-environment jsdom

import { cleanup, fireEvent } from "@testing-library/react";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(installTestPluginRuntime);
afterEach(cleanup);

describe("authorized cross-surface Sync routes", () => {
  it("opens the live Sync panel from both header actions", async () => {
    const { ProductSecurityHeader } = await import(
      "../../product-security/ui/ProductSecurityHeader.js"
    );
    const slot = renderSlot(
      { component: ProductSecurityHeader },
      { subPath: "tara" },
    );

    fireEvent.click(
      slot.getByRole("button", {
        name: "Review local product-security changes in Sync",
      }),
    );
    fireEvent.click(slot.getByRole("button", { name: "Open Sync" }));

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "sync",
        options: { subPath: "product-security" },
      },
      {
        method: "toPluginPanel",
        path: "sync",
        options: { subPath: "product-security" },
      },
    ]);
  });

  it("opens the live Sync panel from the TARA empty-state guidance", async () => {
    const { CanvasEmptyState } = await import(
      "../../product-security/ui/states.js"
    );
    const retry = vi.fn();
    const slot = renderSlot(
      { component: CanvasEmptyState },
      { onRetry: retry },
    );

    fireEvent.click(slot.getByRole("button", { name: "Open Sync" }));

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "sync",
        options: { subPath: "product-security" },
      },
    ]);
    expect(retry).not.toHaveBeenCalled();
  });

  it("enables the merged findings header deep link for its selected scope", async () => {
    const { FindingsHeader } = await import(
      "../../findings/ui/FindingsHeader.js"
    );
    const slot = renderSlot(
      { component: FindingsHeader },
      {
        projects: [{ id: "bb-project", name: "BB project" }],
        projectId: "bb-project",
        versions: [
          {
            platformProjectId: "platform-project",
            projectVersionId: "version-1",
            state: "fresh" as const,
          },
        ],
        platformProjectId: "platform-project",
        projectVersionId: "version-1",
        total: 1,
        loaded: 1,
        selection: { mode: "explicit" as const, keys: new Set<string>() },
        onProject: vi.fn(),
        onVersion: vi.fn(),
        onSelectPage: vi.fn(),
        onSelectPredicate: vi.fn(),
        onClearSelection: vi.fn(),
      },
      {
        rpc: {
          syncStatus: () => ({
            projectId: "platform-project",
            projectVersionId: "version-1",
            acceptedGenerationIds: {},
            stagingGenerationIds: {},
            baseRevisions: {},
            baseStateSha256: "a".repeat(64),
            local: [
              {
                projectId: "platform-project",
                projectVersionId: "version-1",
                kind: "vexDecision",
                key: "vex-1",
                fields: ["status"],
                artifactId: ".fs/triage/vex-1.yaml",
              },
            ],
            upstream: [],
            conflicts: [
              {
                projectId: "platform-project",
                projectVersionId: "version-1",
                kind: "vexDecision",
                key: "vex-1",
                fields: ["status"],
                artifactId: ".fs/triage/vex-1.yaml",
              },
            ],
            orphans: [],
            cache: {
              state: "fresh",
              asOf: "2026-08-13T00:00:00.000Z",
              message: null,
              acceptedGenerationId: "generation-1",
              baseRevision: 1,
            },
          }),
        },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", {
        name: "Open Sync review: 1 local changes and 1 conflict",
      }),
    );

    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "sync",
      options: {
        subPath:
          "scope/platform-project/version-1/surface/vexDecision",
      },
    });
  });
});
