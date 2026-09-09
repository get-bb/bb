import { expect, it } from "vitest";
import { readModalMachineResource } from "./lifecycle.js";

it("retains existing catalogue-machine identity and snapshots without reading the deleted catalogue", () => {
  expect(
    readModalMachineResource({
      version: 4,
      key: "existing",
      sandboxId: null,
      snapshotImageId: "saved-files",
      pendingSnapshotImageIds: ["older-files"],
      imageId: "original-image",
      accountIdentity: "original-account",
      appName: "original-app",
      buildId: "removed-build-record",
      accountRef: "default",
      resources: { cpuCores: 2, memoryMiB: 8192 },
      policy: { idleMinutes: 15, lifetimeMinutes: 1440, retentionDays: 30 },
      policyRevision: 1,
      expiresAt: null,
    }),
  ).toEqual({
    version: 5,
    key: "existing",
    sandboxId: null,
    snapshotImageId: "saved-files",
    pendingSnapshotImageIds: ["older-files"],
    imageId: "original-image",
    accountIdentity: "original-account",
    appName: "original-app",
    cpu: 2,
    memoryMiB: 8192,
    expiresAt: null,
  });
});

it("keeps legacy snapshots recoverable and rejects malformed current resources", () => {
  const legacy = readModalMachineResource({
    version: 3,
    key: "existing",
    sandboxId: null,
    snapshotImageId: "saved",
    pendingSnapshotImageIds: [],
  });
  expect(legacy).toMatchObject({
    snapshotImageId: "saved",
    accountIdentity: null,
    appName: null,
  });
  expect(() =>
    readModalMachineResource({ ...legacy, accountIdentity: "" }),
  ).toThrow();
});
