import { EventEmitter } from "node:events";
import http, { type ClientRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { HttpProxy } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import {
  isLocalLadleRequest,
  signInLocalLadleRequests,
} from "./dev-server-auth";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function classify(headers: Record<string, string>): Promise<boolean> {
  let verdict = false;
  const server = http.createServer((request, response) => {
    verdict = isLocalLadleRequest(request);
    response.end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, headers }, (response) => {
        response.resume();
        response.on("end", resolve);
      })
      .on("error", reject);
  });
  return verdict;
}

describe("Ladle's dev-server sign-in", () => {
  it("signs in only a browser on this machine talking to Ladle directly", async () => {
    expect(await classify({ host: "localhost:61000" })).toBe(true);
    expect(
      await classify({
        host: "127.0.0.1:61000",
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "203.0.113.9",
      }),
    ).toBe(false);
    expect(await classify({ host: "bee-61000.getbb.app" })).toBe(false);
    expect(
      await classify({
        host: "localhost:61000",
        "x-forwarded-for": "127.0.0.1",
      }),
    ).toBe(false);
    expect(
      isLocalLadleRequest({
        socket: { remoteAddress: "192.168.1.20" },
        headers: { host: "localhost:61000" },
      } as IncomingMessage),
    ).toBe(false);
  });

  it("never forwards a credential for a remote request, even one the client sent", () => {
    const proxy = new EventEmitter();
    signInLocalLadleRequests(() => "bbl_dev")(
      proxy as unknown as HttpProxy.Server,
    );
    const outgoing = (): ClientRequest & { headers: Map<string, string> } => {
      const headers = new Map<string, string>([["authorization", "Bearer x"]]);
      return Object.assign(Object.create(null), {
        headers,
        setHeader: (name: string, value: string) => headers.set(name, value),
        removeHeader: (name: string) => headers.delete(name),
      });
    };
    const remote = outgoing();
    proxy.emit("proxyReq", remote, {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { host: "127.0.0.1:61000", "cf-connecting-ip": "203.0.113.9" },
    });
    expect(remote.headers.has("authorization")).toBe(false);
    const local = outgoing();
    proxy.emit("proxyReqWs", local, {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { host: "localhost:61000" },
    });
    expect(local.headers.get("authorization")).toBe("Bearer bbl_dev");
  });
});
