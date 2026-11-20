import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { createFakePluginHost } from "../../../fake-plugin-host.js";

it("opens a fake host database and never disposes the host", () => {
  createFakePluginHost().bb.storage.database();
  expect(
    readdirSync(tmpdir()).some((name) =>
      name.startsWith("bb-fake-plugin-host-"),
    ),
  ).toBe(true);
});
