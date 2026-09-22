import { describe, expect, it } from "vitest";
import { localhostLinkRewriteDescription } from "./localhost-link-rewrite-description";

describe("localhostLinkRewriteDescription", () => {
  it("shows the exact destination for the current host", () => {
    expect(localhostLinkRewriteDescription("100.64.158.8")).toBe(
      "When enabled: http://localhost:3000/ → http://100.64.158.8:3000/",
    );
  });

  it("hides the setting when Connect does not rewrite localhost links", () => {
    expect(localhostLinkRewriteDescription("asdf.getbb.app")).toBeNull();
    expect(localhostLinkRewriteDescription("sawyer.localhost")).toBeNull();
  });

  it("hides the setting when localhost is already the current hostname", () => {
    expect(localhostLinkRewriteDescription("localhost")).toBeNull();
  });
});
