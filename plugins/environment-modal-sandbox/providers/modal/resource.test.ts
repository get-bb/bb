import { expect, it } from "vitest";
import { readModalMachineResource } from "./resource.js";

it("drops obsolete expiration metadata while retaining current snapshot recovery state", () => {
  const resource = {
    key: "existing",
    sandboxId: null,
    snapshotImageId: "saved",
    snapshotSandboxId: "previous-sandbox",
    pendingSnapshotImageIds: ["older-snapshot"],
    imageId: "base-image",
    accountIdentity: "account",
    appName: "app",
    cpu: 2,
    memoryMiB: 8192,
  };
  expect(readModalMachineResource({ ...resource, expiresAt: 123 })).toEqual(
    resource,
  );
  expect(readModalMachineResource(resource)).toEqual(resource);
  for (const field of [
    "imageId",
    "accountIdentity",
    "appName",
    "cpu",
    "memoryMiB",
    "snapshotSandboxId",
  ]) {
    const incomplete = { ...resource };
    delete incomplete[field as keyof typeof incomplete];
    expect(() => readModalMachineResource(incomplete)).toThrow();
  }
  expect(readModalMachineResource({ ...resource, version: 5 })).toEqual(
    resource,
  );
  expect(() =>
    readModalMachineResource({ ...resource, accountIdentity: "" }),
  ).toThrow();
});
