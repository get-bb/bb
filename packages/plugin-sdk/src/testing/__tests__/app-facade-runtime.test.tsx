// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { definePluginApp, experimental_Icon, useBbContext } from "../../app.js";
import { installTestPluginRuntime, loadPluginApp, renderSlot } from "../app.js";

interface RuntimeHost {
  __bbPluginRuntime?: unknown;
}

const host = globalThis as RuntimeHost;
const runtimeAtImport = host.__bbPluginRuntime;
const Icon = experimental_Icon;

afterEach(() => {
  cleanup();
  host.__bbPluginRuntime = runtimeAtImport;
});

function ContextProbe() {
  const context = useBbContext();
  return (
    <p>
      <Icon name="Folder" aria-label="folder" />
      {context.projectId}
    </p>
  );
}

describe("@get-bb/plugin-sdk/app without a runtime at import time", () => {
  it("loaded before any runtime was installed", () => {
    expect(runtimeAtImport).toBeUndefined();
  });

  it("defines a plugin app without a runtime", async () => {
    const definition = definePluginApp((app) => {
      app.slots.homepageSection({
        id: "probe",
        title: "Probe",
        component: ContextProbe,
      });
    });

    expect(definition.__bbPluginApp).toBe(true);
    const app = await loadPluginApp(definition);
    expect(app.homepageSections.map((section) => section.id)).toEqual([
      "probe",
    ]);
  });

  it("renders statically imported components and hooks once a runtime is installed", () => {
    const slot = renderSlot(
      { component: ContextProbe },
      {},
      { context: { projectId: "proj_1" } },
    );

    expect(slot.getByText("proj_1")).toBeTruthy();
    expect(slot.getByLabelText("folder").getAttribute("data-icon")).toBe(
      "Folder",
    );
  });

  it("names the missing runtime when a hook runs without one", () => {
    host.__bbPluginRuntime = undefined;
    expect(() => render(<ContextProbe />)).toThrow(
      /useBbContext needs the bb app's plugin runtime/,
    );
  });

  it("renders a component through the runtime's React", () => {
    installTestPluginRuntime();
    render(<Icon name="Zap" aria-label="zap" />);
    expect(screen.getByLabelText("zap").getAttribute("data-icon")).toBe("Zap");
  });
});
