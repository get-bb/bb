import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  getThreadRoutePath,
  isRoutePath,
  isProjectlessProjectId,
  resolveRouteHref,
} from "./route-paths";

describe("route path helpers", () => {
  it("recognizes the legacy archived URL", () => {
    expect(isRoutePath({ path: "/archived" })).toBe(true);
  });

  it("builds canonical projectless thread detail URLs", () => {
    expect(
      getThreadRoutePath({
        projectId: PERSONAL_PROJECT_ID,
        threadId: "thr_personal",
      }),
    ).toBe("/threads/thr_personal");
  });

  it("keeps standard project thread detail URLs project scoped", () => {
    expect(
      getThreadRoutePath({
        projectId: "proj_standard",
        threadId: "thr_standard",
      }),
    ).toBe("/projects/proj_standard/threads/thr_standard");
  });

  it("recognizes only the personal project id as projectless", () => {
    expect(isProjectlessProjectId(PERSONAL_PROJECT_ID)).toBe(true);
    expect(isProjectlessProjectId("proj_standard")).toBe(false);
    expect(isProjectlessProjectId(undefined)).toBe(false);
  });

  it("recognizes route paths with query and hash suffixes", () => {
    expect(
      isRoutePath({
        path: "/projects/proj_standard/threads/thr_standard?panel=files#row-1",
      }),
    ).toBe(true);
  });

  it("recognizes the global settings route", () => {
    expect(isRoutePath({ path: "/settings" })).toBe(true);
  });

  it("does not mistake deeper filesystem-like paths for routes", () => {
    expect(
      isRoutePath({
        path: "/projects/my-repo/src/file.ts",
      }),
    ).toBe(false);
  });

  it("resolves same-origin hrefs to router paths", () => {
    expect(
      resolveRouteHref({
        currentOrigin: "https://bb.local",
        href: "https://bb.local/projects/proj_standard/threads/thr_standard?q=1",
      }),
    ).toEqual({
      path: "/projects/proj_standard/threads/thr_standard?q=1",
    });
  });

  it("rejects external and protocol-relative route-shaped hrefs", () => {
    expect(
      resolveRouteHref({
        currentOrigin: "https://bb.local",
        href: "https://example.test/projects/proj_standard/threads/thr_standard",
      }),
    ).toBeNull();
    expect(
      resolveRouteHref({
        currentOrigin: "https://bb.local",
        href: "//example.test/projects/proj_standard/threads/thr_standard",
      }),
    ).toBeNull();
  });

  it("rejects fragment-only and query-only hrefs", () => {
    expect(
      resolveRouteHref({
        currentOrigin: "https://bb.local",
        href: "#timeline-row",
      }),
    ).toBeNull();
    expect(
      resolveRouteHref({
        currentOrigin: "https://bb.local",
        href: "?panel=files",
      }),
    ).toBeNull();
  });
});
