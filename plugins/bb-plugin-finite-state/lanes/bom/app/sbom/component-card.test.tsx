// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";

const cache = {
  state: "fresh" as const,
  asOf: "2026-08-12T20:00:00.000Z",
  message: null,
  acceptedGenerationId: "generation-1",
  baseRevision: 1,
};

beforeAll(() => installTestPluginRuntime());
afterEach(() => cleanup());

async function cardRegistration(id: string) {
  const module = await import("./component-card.js");
  return {
    component: () => (
      <module.BomScopeProvider projectId="project-1" projectVersionId="version-1">
        <module.ComponentCard id={id} />
      </module.BomScopeProvider>
    ),
  };
}

function componentResult(id: string) {
  return {
    projectId: "project-1",
    projectVersionId: "version-1",
    kind: "sbomComponent",
    key: id,
    label: "Gateway",
    fields: {
      purl: "pkg:generic/gateway@1",
      version: "1",
      license: "MIT",
      files: ["usr/bin/gateway"],
      findings: [],
    },
    links: [],
    cache,
  };
}

describe("ComponentCard", () => {
  it("self-fetches by ID with no payload prop", async () => {
    const slot = renderSlot(await cardRegistration("component-key"), {}, {
      rpc: { bomComponentGet: (input) => componentResult(
        typeof input === "object" && input !== null &&
          "componentId" in input && typeof input.componentId === "string"
          ? input.componentId
          : "invalid",
      ) },
    });
    expect(await slot.findByText("Gateway")).toBeTruthy();
    expect(slot.inspection.rpcCalls[0]).toMatchObject({
      method: "bomComponentGet",
      input: { componentId: "component-key", mode: "software" },
    });
  });

  it("renders an actionable empty card for an unknown ID", async () => {
    const slot = renderSlot(await cardRegistration("unknown"), {}, {
      rpc: { bomComponentGet: () => Promise.reject(new Error("SBOM_COMPONENT_NOT_FOUND")) },
    });
    expect(await slot.findByText("Component not found")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("renders a retryable RPC failure", async () => {
    let attempts = 0;
    const slot = renderSlot(await cardRegistration("component-key"), {}, {
      rpc: { bomComponentGet: () => {
        attempts += 1;
        return Promise.reject(new Error("Injected RPC failure"));
      } },
    });
    expect(await slot.findByText("Injected RPC failure")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Retry" }));
    expect(attempts).toBeGreaterThanOrEqual(1);
  });

  it("rejects an untrusted ID before RPC and never renders it as markup", async () => {
    const malicious = '<img src=x onerror="alert(1)">';
    const slot = renderSlot(await cardRegistration(` ${malicious}`), {}, {
      rpc: { bomComponentGet: () => componentResult("unused") },
    });
    expect(await slot.findByText("Invalid component identity")).toBeTruthy();
    expect(slot.container.querySelector("img")).toBeNull();
    expect(slot.inspection.rpcCalls).toHaveLength(0);
  });
});
