import { describe, expect, it } from "vitest";
import { isTrustedBrokerDescriptorFile } from "../src/desktop-browser-broker-client.js";

const privateFile = {
  isFile: true,
  mode: 0o100600,
  ownerUid: 501,
  platform: "darwin" as NodeJS.Platform,
  processUid: 501,
  size: 512,
};

describe("isTrustedBrokerDescriptorFile", () => {
  it("accepts a private file owned by the current user", () => {
    expect(isTrustedBrokerDescriptorFile(privateFile)).toBe(true);
  });

  it("refuses a file other users can read or that another user owns", () => {
    expect(
      isTrustedBrokerDescriptorFile({ ...privateFile, mode: 0o100644 }),
    ).toBe(false);
    expect(
      isTrustedBrokerDescriptorFile({ ...privateFile, ownerUid: 502 }),
    ).toBe(false);
  });

  it("accepts the mode Windows reports for every file", () => {
    expect(
      isTrustedBrokerDescriptorFile({
        ...privateFile,
        mode: 0o100666,
        ownerUid: 0,
        platform: "win32",
        processUid: undefined,
      }),
    ).toBe(true);
  });

  it("refuses directories and oversized files on every platform", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(
        isTrustedBrokerDescriptorFile({
          ...privateFile,
          platform,
          isFile: false,
        }),
      ).toBe(false);
      expect(
        isTrustedBrokerDescriptorFile({
          ...privateFile,
          platform,
          size: 16385,
        }),
      ).toBe(false);
    }
  });
});
