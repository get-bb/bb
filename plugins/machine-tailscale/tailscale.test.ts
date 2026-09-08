import { describe, expect, it } from "vitest";
import { parseStatus, validateServe } from "./tailscale.js";

const self = {
  ID: "self",
  HostName: "Server",
  DNSName: "server.example.ts.net.",
  OS: "macOS",
  Online: true,
  TailscaleIPs: ["100.64.0.1"],
};
const peer = {
  ...self,
  ID: "peer",
  HostName: "A Mac",
  DNSName: "mac.example.ts.net.",
};
export const fixture = {
  BackendState: "Running",
  CertDomains: ["SERVER.example.ts.net."],
  Self: self,
  Peer: { a: peer },
};
export function serveFixture(proxy = "http://127.0.0.1:23354") {
  return {
    TCP: { "8443": { HTTPS: true } },
    Web: {
      "server.example.ts.net:8443": { Handlers: { "/": { Proxy: proxy } } },
    },
    AllowFunnel: {},
  };
}
describe("tailnet boundaries", () => {
  it("uses stable IDs and DNS labels, filters self/unsupported/expired peers, retains offline state", () => {
    const status = parseStatus(
      JSON.stringify({
        ...fixture,
        Peer: {
          a: peer,
          self,
          offline: { ...peer, ID: "offline", Online: false },
          expired: { ...peer, ID: "expired", Expired: true },
          phone: { ...peer, ID: "phone", OS: "iOS" },
        },
      }),
    );
    expect(status.devices).toEqual([
      {
        id: "peer",
        label: "A Mac",
        dnsName: "mac.example.ts.net",
        os: "macOS",
        online: true,
      },
      {
        id: "offline",
        label: "A Mac",
        dnsName: "mac.example.ts.net",
        os: "macOS",
        online: false,
      },
    ]);
  });
  it("normalizes certificate eligibility and defaults absent eligibility to empty", () => {
    expect(parseStatus(JSON.stringify(fixture)).certDomains).toEqual([
      "server.example.ts.net",
    ]);
    expect(
      parseStatus(JSON.stringify({ ...fixture, CertDomains: undefined }))
        .certDomains,
    ).toEqual([]);
    expect(
      parseStatus(JSON.stringify({ ...fixture, CertDomains: null }))
        .certDomains,
    ).toEqual([]);
    expect(() =>
      parseStatus(JSON.stringify({ ...fixture, CertDomains: ["bad/domain"] })),
    ).toThrow();
  });
  it("rejects logged-out and malformed states or unsafe DNS", () => {
    expect(() => parseStatus("not json")).toThrow();
    expect(() =>
      parseStatus(JSON.stringify({ ...fixture, BackendState: "NeedsLogin" })),
    ).toThrow("Sign in");
    expect(() =>
      parseStatus(
        JSON.stringify({
          ...fixture,
          Peer: { a: { ...peer, DNSName: "--proxy=evil" } },
        }),
      ),
    ).toThrow();
  });
  it("requires a dedicated private root mapping to this exact instance", () => {
    const valid = serveFixture();
    const check = (config: object) =>
      validateServe(
        JSON.stringify(config),
        "server.example.ts.net",
        8443,
        "http://127.0.0.1:23354",
      );
    expect(check(valid)).toBe("https://server.example.ts.net:8443");
    expect(() => check({})).toThrow();
    expect(() => check(serveFixture("http://127.0.0.1:38886"))).toThrow();
    expect(() =>
      check({ ...valid, AllowFunnel: { "server.example.ts.net:8443": true } }),
    ).toThrow("Funnel");
    expect(() =>
      check({ ...valid, TCP: { "8443": { HTTPS: false } } }),
    ).toThrow();
    expect(() =>
      check({
        ...valid,
        Web: {
          "server.example.ts.net:8443": {
            Handlers: {
              "/": { Proxy: "http://127.0.0.1:23354" },
              "/api": { Proxy: "http://evil" },
            },
          },
        },
      }),
    ).toThrow();
  });
});
