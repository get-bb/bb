import { describe, expect, it } from "vitest";
import { checkDirectServer, pairDirectServer } from "./direct-pairing";

interface Route {
  status: number;
  body: unknown;
}

interface Call {
  url: string;
  authorization: string | null;
  body: string | null;
}

function fakeServer(routes: (call: Call) => Route) {
  const calls: Call[] = [];
  const fetchImpl = async (
    url: string,
    init: {
      headers: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    },
  ) => {
    const call = {
      url: new URL(url).pathname,
      authorization: init.headers.authorization ?? null,
      body: init.body ?? null,
    };
    calls.push(call);
    const route = routes(call);
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.body,
    };
  };
  return { calls, fetchImpl };
}

const SERVER = "http://192.168.1.20:38886";
const config = { serverUrl: SERVER, primaryHostId: null };

function signedInServer(validCode: string) {
  return fakeServer((call) => {
    if (call.url === "/health") return { status: 200, body: { ok: true } };
    if (call.url === "/api/v1/access/pairings/redeem") {
      const { code } = JSON.parse(call.body ?? "{}") as { code: string };
      return code === validCode
        ? {
            status: 200,
            body: {
              kind: "device",
              token: "bbs_phone",
              cookieName: "bb_session_38886",
              credential: { id: "acc_1" },
            },
          }
        : { status: 401, body: { code: "invalid_pairing_code" } };
    }
    return call.authorization === "Bearer bbs_phone"
      ? { status: 200, body: config }
      : { status: 401, body: { code: "unauthenticated" } };
  });
}

describe("direct server sign-in", () => {
  it("connects a server that needs no sign-in without one", async () => {
    const server = fakeServer((call) =>
      call.url === "/health"
        ? { status: 200, body: { ok: true } }
        : { status: 200, body: config },
    );
    expect(await checkDirectServer(SERVER, server.fetchImpl)).toEqual({
      kind: "ready",
      serverUrl: SERVER,
      access: null,
    });
  });

  it("asks for a code, then signs in with it and confirms the token works", async () => {
    const server = signedInServer("ABCDE-FGHJK");
    expect(await checkDirectServer(SERVER, server.fetchImpl)).toMatchObject({
      kind: "needs-code",
      serverUrl: SERVER,
    });
    const paired = await pairDirectServer({
      serverUrl: SERVER,
      code: " ABCDE-FGHJK ",
      label: "bb mobile on Pixel",
      fetchImpl: server.fetchImpl,
    });
    expect(paired).toEqual({
      kind: "ready",
      serverUrl: SERVER,
      access: { token: "bbs_phone", cookieName: "bb_session_38886" },
    });
    expect(server.calls.at(-1)).toMatchObject({
      url: "/api/v1/system/config",
      authorization: "Bearer bbs_phone",
    });
  });

  it("keeps asking for a code when the code is wrong or rate limited", async () => {
    const server = signedInServer("ABCDE-FGHJK");
    expect(
      await pairDirectServer({
        serverUrl: SERVER,
        code: "WRONG-CODE0",
        label: "bb mobile",
        fetchImpl: server.fetchImpl,
      }),
    ).toMatchObject({ kind: "needs-code", message: /wrong, expired/u });

    const limited = fakeServer(() => ({
      status: 429,
      body: { code: "pairing_rate_limited" },
    }));
    expect(
      await pairDirectServer({
        serverUrl: SERVER,
        code: "ABCDE-FGHJK",
        label: "bb mobile",
        fetchImpl: limited.fetchImpl,
      }),
    ).toMatchObject({ kind: "needs-code", message: /Too many wrong codes/u });
  });
});
