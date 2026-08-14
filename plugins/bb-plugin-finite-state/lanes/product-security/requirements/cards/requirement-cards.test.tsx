// @vitest-environment jsdom

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, configure, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { connectedRemoteStatus } from "../../../../test/app-connections.js";
import type { RequirementCardModel } from "./schema.js";
import { rpcContract } from "../../../../shared/contract.js";

const observedElements = new WeakSet<Element>();

class RequirementsResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    if (observedElements.has(target)) return;
    observedElements.add(target);
    queueMicrotask(() => {
      const height =
        target instanceof HTMLElement && target.hasAttribute("data-virtual-row")
          ? 310
          : 720;
      const size = { blockSize: height, inlineSize: 960 };
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 960, height),
            borderBoxSize: [size],
            contentBoxSize: [size],
            devicePixelContentBoxSize: [size],
          },
        ],
        this,
      );
    });
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  configure({ asyncUtilTimeout: 10_000 });
  vi.stubGlobal("ResizeObserver", RequirementsResizeObserver);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const height =
        this instanceof HTMLElement && this.hasAttribute("data-virtual-row")
          ? 310
          : 720;
      return new DOMRect(0, 0, 960, height);
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-virtual-row") ? 310 : 720;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(960);
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

function model(
  index = 1,
  overrides: Partial<RequirementCardModel> = {},
): RequirementCardModel {
  return {
    requirement: {
      schema: "fs-requirement/v1",
      id: `REQ-card-${index}`,
      req_type: "security",
      priority: "P1",
      status: "verified",
      ears: {
        pattern: "event_driven",
        text: "WHEN an update begins, the gateway SHALL verify its signature",
        parts: {
          trigger: "an update begins",
          system: "gateway",
          response: "verify its signature",
        },
      },
      source_description: "Protect the update trust boundary.",
      mitigations: ["mit-signed-update"],
      controls: ["ctrl-secure-boot"],
      standards: ["iec-62443-4-2"],
      verification: [
        {
          check: "check-firmware-signature",
          method: "binary_analysis",
          tier: "static",
          required: true,
          pass_criteria: "The image signature is trusted.",
        },
      ],
    },
    evidenceState: "not_run",
    stale: false,
    local: false,
    tiers: [
      { tier: "static", state: "not_run", count: 1 },
      { tier: "emulation", state: "not_run", count: 0 },
      { tier: "hil", state: "not_run", count: 0 },
      { tier: "manual", state: "not_run", count: 0 },
    ],
    sourceSha256: index.toString(16).padStart(64, "0"),
    ...overrides,
  };
}

function page(
  cardModels: readonly RequirementCardModel[],
  message: string | null = null,
  projectVersionId: string | null = null,
  projectId = "project-1",
) {
  return {
    items: cardModels.map((card) => ({
      projectId,
      projectVersionId,
      kind: "requirement",
      key: card.requirement.id,
      label: card.requirement.id,
      fields: JSON.parse(JSON.stringify(card)),
    })),
    total: cardModels.length,
    next: null,
    cache: {
      state: message ? "stale" : "fresh",
      asOf: "2026-08-12T12:00:00.000Z",
      message,
      acceptedGenerationId: "generation-1",
      baseRevision: 4,
    },
  };
}

async function requirementsPanel() {
  const app = await loadPluginApp(() => import("../../../../app.js"));
  const panel = app.navPanels.find(
    (candidate) => candidate.id === "product-security",
  );
  if (!panel) throw new Error("Product Security panel was not registered");
  return panel;
}

describe("requirement cards", () => {
  it("keeps workflow verified visually distinct from evidence truth and stale state", async () => {
    const evidence = model(1, {
      evidenceState: "failed",
      stale: true,
      local: true,
    });
    const panel = await requirementsPanel();
    const slot = renderSlot(
      panel,
      { subPath: "requirements" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          requirementsList: () => page([evidence], "Accepted cache is stale."),
        },
      },
    );

    expect(await slot.findByLabelText("Loading requirements")).toBeTruthy();
    expect(
      await slot.findByLabelText("Evidence status: Failed evidence"),
    ).toBeTruthy();
    expect(
      slot.getByLabelText("Workflow status: verified; this is not evidence"),
    ).toBeTruthy();
    expect(slot.getByText("stale")).toBeTruthy();
    expect(slot.getByText("local")).toBeTruthy();
    expect(slot.getByRole("status").textContent).toContain(
      "Accepted cache is stale.",
    );
    expect(slot.queryByRole("button", { name: /mark verified/iu })).toBeNull();
    expect(
      [...slot.container.querySelectorAll("strong")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["WHEN", "SHALL"]);
    slot.lifecycle.unmount();
  });

  it("renders unconfigured, empty, and retained-card error states accessibly", async () => {
    const panel = await requirementsPanel();
    const unconfigured = renderSlot(
      panel,
      { subPath: "requirements" },
      {
        context: { projectId: null, threadId: null },
        rpc: { connectionsStatus: connectedRemoteStatus },
      },
    );
    expect(await unconfigured.findByText("Choose a project")).toBeTruthy();
    unconfigured.lifecycle.unmount();

    const empty = renderSlot(
      panel,
      { subPath: "requirements" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          requirementsList: () => page([]),
        },
      },
    );
    expect(await empty.findByText("No requirements yet")).toBeTruthy();
    empty.lifecycle.unmount();

    let fail = false;
    const retained = renderSlot(
      panel,
      { subPath: "requirements" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          requirementsList: () => {
            if (fail) throw new Error("local YAML read failed");
            return page([model()]);
          },
        },
      },
    );
    expect(await retained.findByText("REQ-card-1")).toBeTruthy();
    fail = true;
    fireEvent.click(
      retained.getByRole("button", { name: "Expand requirement" }),
    );
    await retained.behavior.emitRealtime("requirements:changed", {
      projectId: "project-1",
      requirementId: "REQ-card-1",
    });
    await waitFor(() =>
      expect(retained.getByRole("status").textContent).toContain(
        "local YAML read failed",
      ),
    );
    expect(retained.getByText("REQ-card-1")).toBeTruthy();
    retained.lifecycle.unmount();
  });

  it("keeps a 5,000-card fixture to a bounded virtualized DOM", async () => {
    const models = Array.from({ length: 5_000 }, (_, index) =>
      model(index + 1),
    );
    const panel = await requirementsPanel();
    const slot = renderSlot(
      panel,
      { subPath: "requirements" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: { requirementsList: () => page(models) },
      },
    );
    expect(await slot.findByText("5000 loaded")).toBeTruthy();
    await waitFor(() => {
      const cards = slot.container.querySelectorAll(
        "[data-requirement-id]",
      ).length;
      const rows = slot.container.querySelectorAll("[data-virtual-row]").length;
      expect(cards).toBeGreaterThan(0);
      expect(cards).toBeLessThan(50);
      expect(rows).toBeLessThan(50);
    });
    slot.lifecycle.unmount();
  });

  it("refreshes mounted card content and its CAS fence after realtime refetch", async () => {
    const first = model(1);
    const refreshed = model(1, {
      sourceSha256: "f".repeat(64),
      requirement: {
        ...first.requirement,
        ears: {
          ...first.requirement.ears,
          text: "WHEN an update begins, the gateway SHALL quarantine the image",
          parts: {
            ...first.requirement.ears.parts,
            response: "quarantine the image",
          },
        },
      },
    });
    const listInputs: Array<Record<string, unknown>> = [];
    let writeInput: Record<string, unknown> | null = null;
    const panel = await requirementsPanel();
    const slot = renderSlot(
      panel,
      { subPath: "requirements" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          requirementsList: (input) => {
            listInputs.push(rpcContract.requirementsList.input.parse(input));
            return page(
              [listInputs.length === 1 ? first : refreshed],
              null,
              "version-7",
            );
          },
          requirementsWrite: (input) => {
            writeInput = rpcContract.requirementsWrite.input.parse(input);
            return {
              projectId: "project-1",
              projectVersionId: "version-7",
              stableKey: "REQ-card-1",
              beforeSha256: "f".repeat(64),
              afterSha256: "e".repeat(64),
              changedFields: [],
              diffSummary: "local only",
            };
          },
        },
      },
    );
    expect(await slot.findByText(/verify its signature/iu)).toBeTruthy();
    expect(listInputs).toHaveLength(1);
    await slot.behavior.emitRealtime("requirements:changed", {
      projectId: "project-1",
    });
    expect(await slot.findByText(/quarantine the image/iu)).toBeTruthy();
    expect(listInputs).toHaveLength(2);
    expect(listInputs[1]).toEqual(
      expect.objectContaining({
        projectVersionId: null,
        filters: { refresh: true },
      }),
    );
    fireEvent.click(slot.getByRole("button", { name: "Expand requirement" }));
    fireEvent.click(slot.getByRole("button", { name: "Edit local YAML" }));
    fireEvent.submit(
      slot.getByRole("button", { name: "Save local YAML" }).closest("form")!,
    );
    await waitFor(() => expect(writeInput).not.toBeNull());
    expect(writeInput).toEqual(
      expect.objectContaining({
        projectVersionId: "version-7",
        expectedContentSha256: "f".repeat(64),
      }),
    );
    slot.lifecycle.unmount();
  });

  it("offers a ready-state refresh for external YAML changes", async () => {
    const inputs: Array<Record<string, unknown>> = [];
    const panel = await requirementsPanel();
    const slot = renderSlot(
      panel,
      { subPath: "requirements" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          requirementsList: (input) => {
            inputs.push(rpcContract.requirementsList.input.parse(input));
            return page([model()]);
          },
        },
      },
    );
    await slot.findByText("REQ-card-1");
    fireEvent.click(slot.getByRole("button", { name: "Refresh requirements" }));
    await waitFor(() => expect(inputs).toHaveLength(2));
    expect(inputs[1]).toEqual(
      expect.objectContaining({ filters: { refresh: true } }),
    );
    slot.lifecycle.unmount();
  });

  it("resets the accepted project version when the mounted surface switches projects", async () => {
    await requirementsPanel();
    const { RequirementsCards } = await import("./index.js");
    const inputs: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      { component: RequirementsCards },
      { projectId: "project-1" },
      {
        rpc: {
          requirementsList: (input) => {
            const parsed = rpcContract.requirementsList.input.parse(input);
            inputs.push(parsed);
            if (parsed.projectId === "project-1") {
              return page([model(1)], null, "version-1", "project-1");
            }
            return page([model(2)], null, "version-2", "project-2");
          },
        },
      },
    );
    await slot.findByText("REQ-card-1");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        projectVersionId: null,
      }),
    );

    slot.lifecycle.rerender(<RequirementsCards projectId="project-2" />);

    await slot.findByText("REQ-card-2");
    await waitFor(() => expect(inputs).toHaveLength(2));
    expect(inputs[1]).toEqual(
      expect.objectContaining({
        projectId: "project-2",
        projectVersionId: null,
      }),
    );
    expect(slot.queryByText("REQ-card-1")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("saves with the picker-supplied project when the panel route has no project", async () => {
    await requirementsPanel();
    const { RequirementsCardsForProject } = await import("./index.js");
    let writeInput: Record<string, unknown> | null = null;
    const slot = renderSlot(
      { component: RequirementsCardsForProject },
      { projectId: "picker-project" },
      {
        context: { projectId: null, threadId: null },
        rpc: {
          requirementsList: () =>
            page([model()], null, "version-7", "picker-project"),
          requirementsWrite: (input) => {
            writeInput = rpcContract.requirementsWrite.input.parse(input);
            return {
              projectId: "picker-project",
              projectVersionId: "version-7",
              stableKey: "REQ-card-1",
              beforeSha256: model().sourceSha256,
              afterSha256: "e".repeat(64),
              changedFields: [],
              diffSummary: "local only",
            };
          },
        },
      },
    );
    await slot.findByText("REQ-card-1");
    fireEvent.click(slot.getByRole("button", { name: "Expand requirement" }));
    fireEvent.click(slot.getByRole("button", { name: "Edit local YAML" }));
    const saveButton = slot.getByRole("button", { name: "Save local YAML" });
    if (!(saveButton instanceof HTMLButtonElement))
      throw new Error("Save control is not a button");
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);
    await waitFor(() => expect(writeInput).not.toBeNull());
    expect(writeInput).toEqual(
      expect.objectContaining({
        projectId: "picker-project",
        projectVersionId: "version-7",
        requirementId: "REQ-card-1",
        expectedContentSha256: model().sourceSha256,
      }),
    );
    expect(await slot.findByText("local")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("recovers a CAS conflict with current data and a human-readable retry path", async () => {
    const original = model(1);
    const current = model(1, {
      sourceSha256: "c".repeat(64),
      requirement: {
        ...original.requirement,
        ears: {
          ...original.requirement.ears,
          text: "WHEN an update begins, the gateway SHALL retain the installed image",
          parts: {
            ...original.requirement.ears.parts,
            response: "retain the installed image",
          },
        },
      },
    });
    const writes: Array<Record<string, unknown>> = [];
    const panel = await requirementsPanel();
    const slot = renderSlot(
      panel,
      { subPath: "requirements" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          requirementsList: () => page([original]),
          requirementsWrite: (input) => {
            writes.push(rpcContract.requirementsWrite.input.parse(input));
            if (writes.length === 1)
              throw new Error(
                `LOCAL_WRITE_CONFLICT: current ${"c".repeat(64)}`,
              );
            return {
              projectId: "project-1",
              projectVersionId: null,
              stableKey: "REQ-card-1",
              beforeSha256: "c".repeat(64),
              afterSha256: "d".repeat(64),
              changedFields: [],
              diffSummary: "local only",
            };
          },
          requirementsGet: () => ({
            ...page([current]).items[0],
            links: [],
            cache: page([current]).cache,
          }),
        },
      },
    );
    await slot.findByText("REQ-card-1");
    fireEvent.click(slot.getByRole("button", { name: "Expand requirement" }));
    fireEvent.click(slot.getByRole("button", { name: "Edit local YAML" }));
    fireEvent.click(slot.getByRole("button", { name: "Save local YAML" }));
    expect(await slot.findByText(/latest version is loaded/iu)).toBeTruthy();
    expect(
      slot.getAllByText(/retain the installed image/iu).length,
    ).toBeGreaterThan(0);
    fireEvent.click(slot.getByRole("button", { name: "Save local YAML" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toEqual(
      expect.objectContaining({ expectedContentSha256: "c".repeat(64) }),
    );
    slot.lifecycle.unmount();
  });
});
