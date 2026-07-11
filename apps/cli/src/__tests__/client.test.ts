import { afterEach, describe, expect, it, vi } from "vitest";
import { cliFetch } from "../client.js";

const originalCredential = process.env.BB_CONNECT_MACHINE_CREDENTIAL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalCredential === undefined) {
    delete process.env.BB_CONNECT_MACHINE_CREDENTIAL;
  } else {
    process.env.BB_CONNECT_MACHINE_CREDENTIAL = originalCredential;
  }
});

describe("cliFetch", () => {
  it("injects the machine credential without replacing caller headers", async () => {
    process.env.BB_CONNECT_MACHINE_CREDENTIAL = "bbcm_machine";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-bb-connect-machine")).toBe("bbcm_machine");
      expect(headers.get("content-type")).toBe("application/json");
      return new Response("ok");
    });
    vi.stubGlobal("fetch", fetchMock);

    await cliFetch("https://sawyer.getbb.app/api/v1/threads", {
      headers: { "content-type": "application/json" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves requests unchanged when the credential is absent", async () => {
    delete process.env.BB_CONNECT_MACHINE_CREDENTIAL;
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);

    await cliFetch("http://127.0.0.1:38886/api/v1/threads");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:38886/api/v1/threads",
      undefined,
    );
  });
});
