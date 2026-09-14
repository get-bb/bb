import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  displayTarget,
  resolveIdentityFile,
  resolveSshSettings,
  sshMachineInputsSchema,
} from "./target.js";

describe("SSH destination inputs", () => {
  it("accepts aliases, user@host, and bracketed IPv6", () => {
    expect(
      sshMachineInputsSchema.parse({ destination: "daytona-dev" }),
    ).toEqual({ destination: "daytona-dev" });
    expect(
      sshMachineInputsSchema.parse({
        destination: "ubuntu@sandbox.example.com",
        port: 2222,
      }),
    ).toEqual({ destination: "ubuntu@sandbox.example.com", port: 2222 });
    expect(
      sshMachineInputsSchema.parse({ destination: "root@[2001:db8::1]" }),
    ).toEqual({ destination: "root@[2001:db8::1]" });
  });

  it("rejects option injection and shell metacharacters", () => {
    expect(() =>
      sshMachineInputsSchema.parse({ destination: "-oProxyCommand=nc" }),
    ).toThrow();
    expect(() =>
      sshMachineInputsSchema.parse({ destination: "host;id" }),
    ).toThrow();
    expect(() =>
      sshMachineInputsSchema.parse({ destination: "user@host:22" }),
    ).toThrow();
  });
});

describe("SSH settings", () => {
  it("treats a blank identity file as absent and expands ~", () => {
    expect(resolveIdentityFile("  ")).toBeNull();
    expect(resolveIdentityFile("~/id_ed25519")).toBe(
      path.join(homedir(), "id_ed25519"),
    );
  });

  it("rejects identity paths that could be SSH options", () => {
    expect(() => resolveIdentityFile("-oSendEnv=x")).toThrow(
      "identityFile must be a filesystem path.",
    );
  });

  it("requires a known-hosts mode and bounded timeout", () => {
    expect(() =>
      resolveSshSettings({
        identityFile: "",
        knownHosts: "maybe",
        connectTimeoutSeconds: 15,
      }),
    ).toThrow(/knownHosts/u);
    expect(() =>
      resolveSshSettings({
        identityFile: "",
        knownHosts: "yes",
        connectTimeoutSeconds: 0,
      }),
    ).toThrow(/connectTimeoutSeconds/u);
  });

  it("renders the destination with an explicit port", () => {
    expect(displayTarget({ destination: "box" })).toBe("box");
    expect(displayTarget({ destination: "box", port: 2222 })).toBe("box:2222");
  });
});
