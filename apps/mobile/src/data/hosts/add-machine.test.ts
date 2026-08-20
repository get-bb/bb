import type { Host } from "@bb/domain";
import { BbHttpError, type BrowserBbSdk } from "@bb/sdk/browser";
import { describe, expect, it } from "vitest";
import {
  createConnectMachineCode,
  findNewlyConnectedHost,
  formatCountdown,
  isLocalOnlyUrl,
  mintAddMachineCodes,
  pairingCommand,
  resolveAddMachinePresentation,
  type AddMachineCodes,
} from "./add-machine";

const JOIN = { joinCode: "JOIN-1", hostId: "host-new", expiresAt: 2_000 };
const MACHINE = {
  code: "MC-1",
  expiresAt: 1_500,
  serverUrl: "https://bee.getbb.app",
};

function sdkWith(args: {
  rpc: () => Promise<unknown>;
  plugins?: { id: string; enabled: boolean }[];
}): BrowserBbSdk {
  const sdk = {
    hosts: { createJoinCode: async () => JOIN },
    plugins: {
      callRpc: async ({
        outputSchema,
      }: {
        outputSchema: { parse: (value: unknown) => unknown };
      }) => outputSchema.parse(await args.rpc()),
      list: async () => ({ plugins: args.plugins ?? [] }),
    },
  };
  // Only the two areas the add-machine flow touches are modelled.
  return sdk as unknown as BrowserBbSdk;
}

function httpError(status: number, body: unknown, code: string | null = null) {
  return new BbHttpError({ status, body, code, message: `http ${status}` });
}

describe("pairingCommand", () => {
  it("targets the connect serverUrl and appends the machine code when issued", () => {
    expect(pairingCommand("J", "H", MACHINE, "http://127.0.0.1:3000")).toBe(
      "curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 https://bee.getbb.app/install.sh | sh -s -- --join-code J --host-id H --server https://bee.getbb.app --machine-code MC-1",
    );
  });

  it("falls back to the direct server URL without a machine code", () => {
    expect(pairingCommand("J", "H", null, "http://100.64.0.1:3000")).toBe(
      "curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 http://100.64.0.1:3000/install.sh | sh -s -- --join-code J --host-id H --server http://100.64.0.1:3000",
    );
    expect(pairingCommand("J", "H", null, null)).toBeNull();
  });
});

describe("isLocalOnlyUrl", () => {
  it("recognises loopback and unspecified hosts in every spelling", () => {
    for (const url of [
      "http://localhost:3000",
      "http://app.localhost",
      "http://127.0.0.1:3000",
      "http://127.255.0.9",
      "http://[::1]:3000",
      "http://0.0.0.0:3000",
      "http://[::]:3000",
      "http://[::ffff:127.0.0.1]",
      "http://[::ffff:7f00:1]",
    ]) {
      expect(isLocalOnlyUrl(url), url).toBe(true);
    }
  });

  it("leaves routable and invalid URLs alone", () => {
    expect(isLocalOnlyUrl("http://100.64.0.1:3000")).toBe(false);
    expect(isLocalOnlyUrl("https://bee.getbb.app")).toBe(false);
    expect(isLocalOnlyUrl("http://128.0.0.1")).toBe(false);
    expect(isLocalOnlyUrl("not a url")).toBe(false);
  });
});

describe("createConnectMachineCode", () => {
  it("returns the issued code", async () => {
    const sdk = sdkWith({ rpc: async () => MACHINE });
    expect(await createConnectMachineCode(sdk)).toEqual({
      kind: "issued",
      code: MACHINE,
    });
  });

  it("maps not_paired (code, envelope, 404) to unpaired", async () => {
    for (const error of [
      httpError(400, null, "not_paired"),
      httpError(400, { error: { message: "not_paired" } }),
      httpError(404, null),
    ]) {
      const sdk = sdkWith({
        rpc: () => Promise.reject(error),
      });
      expect(await createConnectMachineCode(sdk)).toEqual({ kind: "unpaired" });
    }
  });

  it("asks the plugin list whether a 503 means disabled or merely starting", async () => {
    const disabled = sdkWith({
      rpc: () => Promise.reject(httpError(503, null)),
      plugins: [{ id: "connect", enabled: false }],
    });
    expect(await createConnectMachineCode(disabled)).toEqual({
      kind: "disabled",
    });
    const starting = sdkWith({
      rpc: () => Promise.reject(httpError(503, null)),
      plugins: [{ id: "connect", enabled: true }],
    });
    expect(await createConnectMachineCode(starting)).toEqual({
      kind: "unavailable",
    });
    const unprocessable = sdkWith({
      rpc: () => Promise.reject(httpError(422, null)),
    });
    expect(await createConnectMachineCode(unprocessable)).toEqual({
      kind: "unavailable",
    });
  });

  it("rethrows anything else", async () => {
    const sdk = sdkWith({ rpc: () => Promise.reject(httpError(500, null)) });
    await expect(createConnectMachineCode(sdk)).rejects.toBeInstanceOf(
      BbHttpError,
    );
    const broken = sdkWith({ rpc: () => Promise.reject(new Error("boom")) });
    await expect(createConnectMachineCode(broken)).rejects.toThrow("boom");
  });

  it("mints both codes together", async () => {
    const sdk = sdkWith({ rpc: async () => MACHINE });
    expect(await mintAddMachineCodes(sdk)).toEqual({
      join: JOIN,
      machine: { kind: "issued", code: MACHINE },
    });
  });
});

describe("resolveAddMachinePresentation", () => {
  const issued: AddMachineCodes = {
    join: JOIN,
    machine: { kind: "issued", code: MACHINE },
  };

  it("shows loading, then the command with the earliest expiry", () => {
    expect(
      resolveAddMachinePresentation({
        codes: null,
        error: null,
        serverUrl: "http://127.0.0.1:3000",
      }),
    ).toEqual({ kind: "loading" });
    const presentation = resolveAddMachinePresentation({
      codes: issued,
      error: null,
      serverUrl: "http://127.0.0.1:3000",
    });
    expect(presentation.kind).toBe("command");
    if (presentation.kind !== "command") throw new Error("unreachable");
    expect(presentation.expiresAt).toBe(1_500);
    expect(presentation.viaConnect).toBe(true);
    expect(presentation.command).toContain("--machine-code MC-1");
  });

  it("explains instead of printing a loopback command when connect cannot help", () => {
    expect(
      resolveAddMachinePresentation({
        codes: { join: JOIN, machine: { kind: "unpaired" } },
        error: null,
        serverUrl: "http://127.0.0.1:3000",
      }),
    ).toEqual({
      kind: "unreachable",
      serverUrl: "http://127.0.0.1:3000",
      reason: "unpaired",
    });
    expect(
      resolveAddMachinePresentation({
        codes: { join: JOIN, machine: { kind: "disabled" } },
        error: null,
        serverUrl: "http://localhost:3000",
      }).kind,
    ).toBe("unreachable");
    expect(
      resolveAddMachinePresentation({
        codes: { join: JOIN, machine: { kind: "unavailable" } },
        error: null,
        serverUrl: "http://localhost:3000",
      }),
    ).toEqual({ kind: "connect-unavailable" });
  });

  it("uses a routable direct URL when connect is unpaired", () => {
    const presentation = resolveAddMachinePresentation({
      codes: { join: JOIN, machine: { kind: "unpaired" } },
      error: null,
      serverUrl: "http://100.64.0.1:3000",
    });
    expect(presentation.kind).toBe("command");
    if (presentation.kind !== "command") throw new Error("unreachable");
    expect(presentation.viaConnect).toBe(false);
    expect(presentation.expiresAt).toBe(JOIN.expiresAt);
    expect(presentation.command).toContain("--server http://100.64.0.1:3000");
  });

  it("surfaces a mint error and a missing server URL", () => {
    expect(
      resolveAddMachinePresentation({
        codes: null,
        error: "nope",
        serverUrl: null,
      }),
    ).toEqual({ kind: "error", message: "nope" });
    expect(
      resolveAddMachinePresentation({
        codes: { join: JOIN, machine: { kind: "unpaired" } },
        error: null,
        serverUrl: null,
      }).kind,
    ).toBe("error");
  });
});

describe("formatCountdown / findNewlyConnectedHost", () => {
  it("formats m:ss and clamps at zero", () => {
    expect(formatCountdown(125_000)).toBe("2:05");
    expect(formatCountdown(900)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });

  it("finds the connected host outside the baseline", () => {
    const base = { id: "a", status: "connected" } as Host;
    const fresh = { id: "b", status: "connected" } as Host;
    const offline = { id: "c", status: "disconnected" } as Host;
    expect(findNewlyConnectedHost([base, offline], new Set(["a"]))).toBeNull();
    expect(findNewlyConnectedHost([base, fresh], new Set(["a"]))?.id).toBe("b");
    expect(findNewlyConnectedHost([base, fresh], null)).toBeNull();
    expect(findNewlyConnectedHost(undefined, new Set())).toBeNull();
  });
});
