// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";

const cache = {
  state: "fresh" as const,
  asOf: "2026-08-13T12:00:00.000Z",
  message: null,
  acceptedGenerationId: "g1",
  baseRevision: 1,
};
const host = {
  id: "host-1",
  name: "Bench One",
  status: "connected",
  capabilities: [
    "forgeCompute",
    "allowPentest",
    "docker",
    "cveEvidenceVerifier",
  ],
  lastSeenAt: "2026-08-13T12:00:00.000Z",
};

type AttemptResult =
  | {
      success: true;
      run: {
        projectId: string;
        projectVersionId: string;
        runId: string;
        threadId: string;
        jobIds: string[];
        firmwareSha256: string;
        status: "running";
      };
    }
  | {
      success: false;
      runId: string;
      code: string;
      message: string;
    };

beforeAll(() => installTestPluginRuntime());
afterEach(() => cleanup());

async function launcher(
  tier: "tier0" | "tier1",
  start = vi.fn<() => Promise<AttemptResult>>(async () => ({
    success: true as const,
    run: {
      projectId: "p1",
      projectVersionId: "v1",
      runId: "run-1",
      threadId: "thread-1",
      jobIds: [],
      firmwareSha256: "a".repeat(64),
      status: "running" as const,
    },
  })),
  onFailed = vi.fn(),
) {
  const { RunLauncher } = await import("./run-launcher.js");
  const slot = renderSlot(
    {
      component: () => (
        <RunLauncher
          initialTier={tier}
          onClose={() => {}}
          onFailed={onFailed}
          onStarted={() => {}}
          projectId="p1"
          projectVersionId="v1"
        />
      ),
    },
    {},
    {
      rpc: {
        benchHostsList: () => ({ items: [host], total: 1, next: null, cache }),
        firmwareMountsList: () => ({
          items: [
            {
              projectId: "p1",
              projectVersionId: "v1",
              kind: "firmwareMount",
              key: "fw",
              label: "fw",
              fields: { artifactHash: "a".repeat(64) },
            },
          ],
          total: 1,
          next: null,
          cache,
        }),
        benchRunAttemptStart: start,
      },
    },
  );
  await slot.findByRole("option", { name: /Bench One/u });
  fireEvent.change(slot.getByLabelText("Host"), {
    target: { value: "host-1" },
  });
  return { onFailed, slot, start };
}

describe("RunLauncher", () => {
  it("preflights Tier 0, confirms, and guards double submit", async () => {
    const { slot, start } = await launcher("tier0");
    const startButton = slot.getByRole("button", { name: "Start Tier 0" });
    expect(startButton.getAttribute("disabled")).not.toBeNull();
    fireEvent.click(slot.getByText(/I confirm/u));
    await waitFor(() =>
      expect(startButton.getAttribute("disabled")).toBeNull(),
    );
    fireEvent.click(startButton);
    fireEvent.click(startButton);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thread-1",
    });
  });

  it("requires every Tier 1 deployment-context field and target", async () => {
    const { slot, start } = await launcher("tier1");
    fireEvent.change(slot.getByLabelText(/Requirement/u), {
      target: { value: "REQ-1" },
    });
    fireEvent.change(slot.getByLabelText(/Target/u), {
      target: { value: "CVE-2026-1@component-1" },
    });
    for (const input of slot.container.querySelectorAll<HTMLInputElement>(
      'input[id^="deployment-"]',
    ))
      fireEvent.change(input, { target: { value: "configured" } });
    fireEvent.click(slot.getByText(/I confirm/u));
    const button = slot.getByRole("button", { name: "Start Tier 1" });
    await waitFor(() => expect(button.getAttribute("disabled")).toBeNull());
    fireEvent.click(button);
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentContext: expect.objectContaining({
            productType: "configured",
            rootComponentType: "configured",
          }),
        }),
      ),
    );
  });

  it("blocks Tier 1 when host prerequisites are absent", async () => {
    const { RunLauncher } = await import("./run-launcher.js");
    const slot = renderSlot(
      {
        component: () => (
          <RunLauncher
            initialTier="tier1"
            onClose={() => {}}
            onStarted={() => {}}
            projectId="p1"
            projectVersionId="v1"
          />
        ),
      },
      {},
      {
        rpc: {
          benchHostsList: () => ({
            items: [{ ...host, capabilities: [] }],
            total: 1,
            next: null,
            cache,
          }),
          firmwareMountsList: () => ({
            items: [],
            total: 0,
            next: null,
            cache,
          }),
        },
      },
    );
    await slot.findByRole("option", { name: /Bench One/u });
    fireEvent.change(slot.getByLabelText("Host"), {
      target: { value: "host-1" },
    });
    expect(slot.getByText(/Missing Tier 1 prerequisites/u)).toBeTruthy();
    expect(
      slot
        .getByRole("button", { name: "Start Tier 1" })
        .getAttribute("disabled"),
    ).not.toBeNull();
  });

  it("opens the durable failed attempt returned by the registered action result", async () => {
    const start = vi.fn(async () => ({
      success: false as const,
      runId: "bench-failed-1",
      code: "FORGE_COMPUTE_UNAVAILABLE",
      message: "Forge registration is unavailable",
    }));
    const { onFailed, slot } = await launcher("tier0", start);
    fireEvent.click(slot.getByText(/I confirm/u));
    fireEvent.click(await slot.findByRole("button", { name: "Start Tier 0" }));
    await waitFor(() =>
      expect(onFailed).toHaveBeenCalledWith(
        "bench-failed-1",
        "Forge registration is unavailable",
      ),
    );
  });
});
