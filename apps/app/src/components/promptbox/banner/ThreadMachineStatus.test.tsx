import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThreadMachineStatusBanner } from "./ThreadMachineStatus";

const provider = {
  id: "modal-sandbox",
  displayName: "Modal Sandbox",
  description: "Run a machine for development.",
  icon: "Cloud",
  logoUrl: null,
  pluginId: "environment-modal-sandbox",
  inputs: null,
  acceptsEmptyInputs: true,
  supportsSuspend: true,
};

function renderBanner(phase: "suspending" | "suspended" | "resuming") {
  const markup = renderToStaticMarkup(
    <ThreadMachineStatusBanner
      host={{
        name: "Modal sandbox ugxe6e",
        type: "ephemeral",
        machineProviderId: provider.id,
      }}
      provider={provider}
      phase={phase}
      error={null}
      onResume={() => {}}
    />,
  );
  return {
    markup,
    status: markup
      .match(/role="status">(.*?)<\/div>/)?.[1]
      ?.replace(/<[^>]+>/g, ""),
    buttons: [...markup.matchAll(/<button([^>]*)>(.*?)<\/button>/g)],
  };
}

describe("ThreadMachineStatusBanner", () => {
  it("names the paused state generically and keeps the provider icon", () => {
    const { markup, status, buttons } = renderBanner("suspended");

    expect(status).toBe("Machine is paused");
    expect(markup).toContain('data-icon="Cloud"');
    expect(markup).not.toContain("Modal sandbox ugxe6e");
    expect(markup).not.toContain(provider.displayName);
    expect(buttons.map((button) => button[2])).toEqual(["Resume"]);
    expect(buttons[0]?.[1]).not.toContain('disabled=""');
  });

  it.each([
    ["suspending", "Machine is pausing…"],
    ["resuming", "Machine is resuming…"],
  ] as const)("renders the durable %s phase", (phase, expected) => {
    const { status, buttons } = renderBanner(phase);

    expect(status).toBe(expected);
    expect(buttons).toEqual([]);
  });
});
