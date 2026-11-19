import { describe, expect, it } from "vitest";
import { headersForLoopbackRequest } from "../src/headers.js";

describe("headersForLoopbackRequest", () => {
  it("replaces a client-supplied copy of a header the origin stamps, whatever its case", () => {
    const headers = headersForLoopbackRequest(
      [
        ["X-BB-Tunnel-Marker", "client-guess"],
        ["x-bb-tunnel-marker", "second-guess"],
        ["Accept", "application/json"],
      ],
      {
        publicOrigin: "https://bee.getbb.app",
        loopbackOrigin: "http://127.0.0.1:38886",
        headers: { "x-bb-tunnel-marker": "start-secret" },
      },
    );
    expect(headers).toEqual({
      Accept: "application/json",
      "x-bb-tunnel-marker": "start-secret",
    });
  });
});
