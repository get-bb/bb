// @vitest-environment jsdom

import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../../../app.js"));
const { isFirmwareBinaryMetadata } = await import("./binary-opener.js");
const registration = app.fileOpeners.find((entry) => entry.id === "firmware-binary")!;
const props = {
  path: ".fs-firmware/pv-1/rootfs/usr/bin/busybox",
  source: {
    kind: "workspace" as const,
    threadId: "thread-1",
    projectId: "project-1",
    environmentId: "env-1",
  },
};

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    firmwarePath: "usr/bin/busybox",
    fileSha256: "a".repeat(64),
    size: 4096,
    mediaType: "application/x-executable",
    fields: {
      fullType: "ELF 64-bit LSB executable",
      architecture: "x86_64",
      mode: "0755",
      uid: 0,
      gid: 0,
      setuid: true,
      setgid: false,
      securityFeatures: { nx: true, pie: false },
    },
    previewHex: "7f454c46".padEnd(512, "0"),
    previewBytes: 256,
    materialized: true,
    ...overrides,
  };
}

afterEach(cleanup);

describe("firmware binary opener", () => {
  it("matches ELF and manifest-typed extensionless executables", () => {
    expect(isFirmwareBinaryMetadata("application/x-executable", "ELF executable", "usr/bin/busybox")).toBe(true);
    expect(isFirmwareBinaryMetadata(null, "ELF 64-bit executable", "usr/bin/init")).toBe(true);
    expect(isFirmwareBinaryMetadata(null, null, "usr/bin/no-extension")).toBe(false);
  });

  it("renders ELF metadata and a bounded 256-byte hex preview, never raw text", async () => {
    const slot = renderSlot(registration, props, { rpc: { firmwareFileGet: () => metadata() } });
    await slot.findByText("x86_64");
    slot.getByText("4,096 bytes");
    slot.getByText("setuid");
    slot.getByText("nx: true");
    const preview = slot.getByLabelText("256-byte bounded hex preview");
    expect(preview.textContent?.split("\n")).toHaveLength(16);
    expect(preview.textContent).not.toContain("ELF 64-bit LSB executable");
  });

  it("offers only per-file hydration and explains an admin 403 recovery", async () => {
    const slot = renderSlot(registration, props, {
      rpc: {
        firmwareFileGet: () => metadata({ previewHex: null, previewBytes: 0, materialized: false }),
        firmwareFileHydrate: () => { throw new Error("403 VIEW_ANY_PROJECT_FILE"); },
      },
    });
    const hydrate = await slot.findByRole("button", { name: "Hydrate this file" });
    expect(slot.queryByRole("button", { name: /Hydrate all/u })).toBeNull();
    fireEvent.click(hydrate);
    expect(await slot.findByText(/Ask an org admin for elevated permission, or use Local image with standalone unpack/u)).toBeTruthy();
  });

  it("falls back to a safe metadata view for an unknown MIME", async () => {
    const slot = renderSlot(registration, props, {
      rpc: { firmwareFileGet: () => metadata({ mediaType: "application/x-unknown", fields: {} }) },
    });
    expect(await slot.findByText("Unknown type · safe view")).toBeTruthy();
    expect(slot.getByText(/no Tier 0 analysis is cached/u)).toBeTruthy();
  });
});
