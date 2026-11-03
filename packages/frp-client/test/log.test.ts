import { describe, expect, it } from "vitest";
import { FRP_LOGIN_REFUSED_REASON } from "@bb/tunnel-contract/next";
import { cleanFrpcLine, parseFrpcLine } from "../src/log.js";

describe("parseFrpcLine", () => {
  it.each([
    [
      "2026-10-20 17:31:17.268 [I] [client/service.go:312] try to connect to server...",
      { kind: "connecting" },
    ],
    [
      "2026-10-20 17:42:32.699 [I] [client/service.go:312] [bf12a37cb81dbf2c] try to connect to server...",
      { kind: "connecting" },
    ],
    [
      "2026-10-20 17:31:17.275 [I] [client/service.go:332] [7353a5588590646d] login to server success, get run id [7353a5588590646d]",
      { kind: "logged-in" },
    ],
    [
      "2026-10-20 17:31:17.276 [I] [client/control.go:174] [7353a5588590646d] [bb] start proxy success",
      { kind: "proxy-started", proxy: "bb" },
    ],
    [
      "2026-10-20 23:26:43.128 [I] [client/control.go:174] [8a751a9516e6ebed] [share-5173] start proxy success",
      { kind: "proxy-started", proxy: "share-5173" },
    ],
    [
      "2026-10-20 23:26:51.771 [I] [proxy/proxy_manager.go:165] [8a751a9516e6ebed] proxy removed: [share-5173]",
      { kind: "proxy-removed", proxy: "share-5173" },
    ],
    [
      `2026-10-20 17:31:29.350 [W] [client/service.go:323] connect to server error: ${FRP_LOGIN_REFUSED_REASON}`,
      { kind: "refused", reason: FRP_LOGIN_REFUSED_REASON },
    ],
    [
      "2026-10-20 17:31:29.350 [W] [client/service.go:323] connect to server error: the gate could not check this",
      { kind: "offline", reason: "the gate could not check this" },
    ],
    [
      `2026-10-20 17:31:29.350 [W] [client/service.go:323] connect to server error: ${FRP_LOGIN_REFUSED_REASON} (again)`,
      {
        kind: "offline",
        reason: `${FRP_LOGIN_REFUSED_REASON} (again)`,
      },
    ],
    [
      "2026-10-20 17:31:32.354 [W] [client/service.go:323] connect to server error: dial tcp 127.0.0.1:17099: connect: connection refused",
      {
        kind: "offline",
        reason: "dial tcp 127.0.0.1:17099: connect: connection refused",
      },
    ],
    [
      "2026-10-20 17:31:32.354 [W] [client/service.go:323] connect to server error: tls: failed to verify certificate: x509: certificate signed by unknown authority",
      {
        kind: "offline",
        reason:
          "tls: failed to verify certificate: x509: certificate signed by unknown authority",
      },
    ],
    [
      "2026-10-20 17:31:32.354 [W] [client/service.go:323] connect to server error: EOF",
      { kind: "offline", reason: "EOF" },
    ],
    [
      "2026-10-20 17:31:32.354 [W] [client/control.go:170] [7353a5588590646d] [bb] start error: a server may only claim its own label",
      {
        kind: "proxy-refused",
        proxy: "bb",
        reason: "a server may only claim its own label",
      },
    ],
  ])("%s", (line, event) => {
    expect(parseFrpcLine(line)).toEqual(event);
  });

  it("ignores lines that say nothing about the connection", () => {
    expect(
      parseFrpcLine(
        "2026-10-20 17:31:17.275 [I] [proxy/proxy_manager.go:183] [7353a5588590646d] proxy added: [bb]",
      ),
    ).toBeNull();
  });
});

describe("cleanFrpcLine", () => {
  it("strips colour codes and redacts secrets", () => {
    expect(
      cleanFrpcLine("\u001b[1;34mlogin with bbcred_secret now\u001b[0m  ", [
        "bbcred_secret",
      ]),
    ).toBe("login with [redacted] now");
  });
});
