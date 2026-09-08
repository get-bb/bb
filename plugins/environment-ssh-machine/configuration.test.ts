import { describe, expect, it } from "vitest";
import { sshMachineInputsSchema } from "./configuration.js";

describe("SSH input boundary", () => {
  it.each(["buildbox", "dev@build.example.com", "dev@[2001:db8::1]"])(
    "accepts %s",
    (target) => {
      expect(sshMachineInputsSchema.parse({ target })).toEqual({ target });
    },
  );
  it.each([
    "",
    "-oProxyCommand=id",
    "host;id",
    "a\nb",
    "a\0b",
    "user@@host",
    "user@-host",
    "$(id)",
  ])("rejects unsafe destination %s", (target) => {
    expect(sshMachineInputsSchema.safeParse({ target }).success).toBe(false);
  });
  it("rejects ignored options", () => {
    expect(
      sshMachineInputsSchema.safeParse({
        target: "box",
        serverUrl: "https://bb.example",
      }).success,
    ).toBe(false);
  });
});
