import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connectionStatusMessage,
  diagnoseRemoteFailure,
  responseError,
  transportError,
  unavailableError,
  withRemoteRequestTimeout,
} from "./errors.js";

const request = {
  method: "GET",
  url: "https://fs-alpha.finitestate.io/api/api/projects?limit=1",
  phase: "request headers for /api/projects",
};

afterEach(() => vi.useRealTimers());

describe("remote failure diagnostics", () => {
  it("makes definitive auth failures actionable and preserves the first status", async () => {
    const unauthorized = await responseError(
      "assurance-studio",
      Response.json({ error: "unauthorized" }, { status: 401 }),
      Date.now(),
      request,
    );

    expect(diagnoseRemoteFailure(unauthorized)).toEqual({
      kind: "authentication",
      message:
        "Assurance Studio authentication failed for GET https://fs-alpha.finitestate.io/api/api/projects?limit=1 with HTTP 401 using X-API-Key. Refresh Assurance Studio API key (asApiKey).",
      retryable: false,
      service: "assurance-studio",
      status: 401,
      request,
      credential: {
        header: "X-API-Key",
        label: "Assurance Studio API key",
        setting: "asApiKey",
      },
    });
    expect(unauthorized).toMatchObject({
      code: "REMOTE_HTTP_401",
      status: 401,
      details: {
        request: {
          method: "GET",
          url: request.url,
          phase: request.phase,
        },
      },
    });
  });

  it("shows method, full credential-free URL, and status for other HTTP rejections", async () => {
    const rejected = await responseError(
      "assurance-studio",
      new Response(null, { status: 404 }),
      Date.now(),
      request,
    );

    expect(rejected.message).toBe("Remote service rejected the request");
    expect(diagnoseRemoteFailure(rejected)).toEqual({
      kind: "http",
      message:
        "Assurance Studio rejected GET https://fs-alpha.finitestate.io/api/api/projects?limit=1 with HTTP 404.",
      retryable: false,
      service: "assurance-studio",
      status: 404,
      request,
      credential: null,
    });
  });

  it("keeps settings and network-unreachable failures distinct", () => {
    expect(diagnoseRemoteFailure(unavailableError("platform"))).toEqual({
      kind: "settings",
      message:
        "Platform is not configured. Set Platform URL (platformBaseUrl) and Platform token (platformToken).",
      retryable: false,
      service: "platform",
      status: null,
      request: null,
      credential: null,
    });
    expect(
      diagnoseRemoteFailure(
        transportError(
          "platform",
          "getProjectsV0",
          true,
          new TypeError("fetch failed"),
          {
            method: "GET",
            url: "https://platform.example/api/public/v0/projects",
            phase: "request headers for getProjectsV0",
          },
        ),
      ),
    ).toEqual({
      kind: "network-unreachable",
      message:
        "Platform could not be reached during GET https://platform.example/api/public/v0/projects. Check DNS, proxy, and network connectivity.",
      retryable: true,
      service: "platform",
      status: null,
      request: {
        method: "GET",
        url: "https://platform.example/api/public/v0/projects",
        phase: "request headers for getProjectsV0",
      },
      credential: null,
    });
  });

  it("does not misclassify an internal exception as network unreachability", () => {
    const diagnostic = diagnoseRemoteFailure(new TypeError("client defect"));

    expect(diagnostic).toEqual({
      kind: "unknown",
      message:
        "Remote request failed unexpectedly. Retry, then inspect the plugin logs if the failure persists.",
      retryable: false,
      service: null,
      status: null,
      request: null,
      credential: null,
    });
    expect(connectionStatusMessage(diagnostic)).toBe(
      "Remote service request failed unexpectedly.",
    );
  });

  it("reports elapsed time and phase without retrying a timed-out request", async () => {
    vi.useFakeTimers();
    const timedOut = withRemoteRequestTimeout(
      "assurance-studio",
      request,
      undefined,
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
      45,
    );

    const assertion = expect(timedOut).rejects.toMatchObject({
      code: "REMOTE_TIMEOUT",
      retryable: false,
      details: {
        elapsedMs: 45,
        phase: request.phase,
      },
      message:
        "Assurance Studio timed out after 45ms during request headers for /api/projects (GET https://fs-alpha.finitestate.io/api/api/projects?limit=1).",
    });
    await vi.advanceTimersByTimeAsync(45);
    await assertion;
  });
});
