import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { MachineEnvironment } from "./machine-environment.js";

it("makes machine settings available to arbitrary child commands and removes stale values", () => {
  const target = { ...process.env, MACHINE_EXISTING: "original" };
  const environment = new MachineEnvironment(target, {
    MACHINE_EXISTING: "shell-original",
  });
  environment.replace([
    {
      name: "MACHINE_EXISTING",
      value: "configured",
      source: { core: "machine-environment" },
      reason: "test",
    },
    {
      name: "MACHINE_NEW",
      value: "first",
      source: { core: "machine-environment" },
      reason: "test",
    },
  ]);
  const readChild = () =>
    execFileSync(
      process.execPath,
      [
        "-e",
        "process.stdout.write(JSON.stringify([process.env.MACHINE_EXISTING, process.env.MACHINE_NEW]))",
      ],
      { env: target, encoding: "utf8" },
    );
  expect(JSON.parse(readChild())).toEqual(["configured", "first"]);
  expect(environment.shellEnvironment({ MACHINE_EXISTING: "stale" })).toEqual({
    MACHINE_EXISTING: "configured",
    MACHINE_NEW: "first",
  });
  environment.replace([
    {
      name: "MACHINE_NEW",
      value: "second",
      source: { core: "machine-environment" },
      reason: "test",
    },
  ]);
  expect(JSON.parse(readChild())).toEqual(["original", "second"]);
  environment.replace([]);
  expect(JSON.parse(readChild())).toEqual(["original", null]);
  expect(
    environment.shellEnvironment({
      MACHINE_EXISTING: "configured",
      MACHINE_NEW: "first",
    }),
  ).toEqual({ MACHINE_EXISTING: "shell-original" });
});

it("resolves server-relative entries and preserves explicitly empty values", () => {
  const target = {
    BB_SERVER_URL: "https://server.example",
    MACHINE_VALUE: "original",
  };
  const environment = new MachineEnvironment(target, {});
  environment.replace([
    {
      name: "MACHINE_VALUE",
      value: "",
      source: { core: "machine-environment" },
      reason: "test",
    },
    {
      name: "MACHINE_URL",
      value: { serverPath: "/api/proxy" },
      source: { plugin: "test" },
      reason: "test",
    },
  ]);
  expect(environment.shellEnvironment({})).toEqual({
    MACHINE_VALUE: "",
    MACHINE_URL: "https://server.example/api/proxy",
  });
});
