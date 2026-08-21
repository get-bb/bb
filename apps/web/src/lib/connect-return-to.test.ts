import { describe, expect, it } from "vitest";

import { connectReturnTo } from "./connect-return-to";

describe("connect return-to URLs", () => {
  it("accepts immediate connect subdomains for the current app domain", () => {
    expect(
      connectReturnTo(
        "https://sawyer.getbb.app/projects?tab=threads",
        "https://getbb.app",
      ),
    ).toBe("https://sawyer.getbb.app/projects?tab=threads");
  });

  it("accepts staging connect subdomains", () => {
    expect(
      connectReturnTo(
        "https://sawyer.vibecodethis.site/",
        "https://vibecodethis.site",
      ),
    ).toBe("https://sawyer.vibecodethis.site/");
  });

  it("accepts local Cloud handles under the shared cookie domain", () => {
    expect(
      connectReturnTo(
        "http://sawyer.bb.localhost:42745/threads/thr_1",
        "http://bb.localhost:42745",
      ),
    ).toBe("http://sawyer.bb.localhost:42745/threads/thr_1");
  });

  it("rejects nested subdomains and off-domain return targets", () => {
    expect(
      connectReturnTo("https://a.b.getbb.app/", "https://getbb.app"),
    ).toBeNull();
    expect(
      connectReturnTo("https://evil.test/", "https://getbb.app"),
    ).toBeNull();
  });

  it("rejects protocol downgrades", () => {
    expect(
      connectReturnTo("http://sawyer.getbb.app/", "https://getbb.app"),
    ).toBeNull();
  });

  it("treats absent and the literal 'null'/'undefined' strings as no return target", () => {
    expect(connectReturnTo(null, "https://getbb.app")).toBeNull();
    expect(connectReturnTo(undefined, "https://getbb.app")).toBeNull();
    expect(connectReturnTo("", "https://getbb.app")).toBeNull();
    expect(connectReturnTo("null", "https://getbb.app")).toBeNull();
    expect(connectReturnTo("undefined", "https://getbb.app")).toBeNull();
  });
});
