import { describe, expect, it } from "vitest";
import { tunnelServerUrl } from "@bb/frp-client";
import { nextSiteForAccount } from "./next-site.js";

describe("nextSiteForAccount", () => {
  it.each([
    [
      "https://getbb.app",
      "next.getbb.app",
      "https://sawyer.next.getbb.app",
      "wss://tunnel.next.getbb.app/~!frp",
    ],
    [
      "https://vibecodethis.site",
      "next.vibecodethis.site",
      "https://sawyer.next.vibecodethis.site",
      "wss://tunnel.next.vibecodethis.site/~!frp",
    ],
    [
      "http://bb.localhost:35067",
      "next.bb.localhost:35067",
      "http://sawyer.next.bb.localhost:35067",
      "ws://tunnel.next.bb.localhost:35067/~!frp",
    ],
  ])("%s → %s", (baseUrl, domain, origin, tunnel) => {
    const site = nextSiteForAccount(baseUrl);
    expect(site.domain).toBe(domain);
    expect(site.origin("sawyer")).toBe(origin);
    expect(tunnelServerUrl(site.tunnelServer)).toBe(tunnel);
  });

  it("dials 443 for an https account", () => {
    expect(nextSiteForAccount("https://getbb.app").tunnelServer).toEqual({
      protocol: "wss",
      host: "tunnel.next.getbb.app",
      port: 443,
    });
  });
});
