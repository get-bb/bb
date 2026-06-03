import { describe, expect, it } from "vitest";
import {
  resolveApplicationDataPath,
  resolveApplicationPath,
} from "../src/app-storage-paths.js";

describe("app storage paths", () => {
  it("uses validated application ids as path segments", () => {
    expect(resolveApplicationPath("/tmp/bb-data", "review-board")).toBe(
      "/tmp/bb-data/apps/review-board",
    );
    expect(resolveApplicationDataPath("/tmp/bb-data", "status")).toBe(
      "/tmp/bb-data/apps/status/data",
    );
  });

  it("rejects invalid application id path segments", () => {
    expect(() => resolveApplicationPath("/tmp/bb-data", "a/b")).toThrow();
  });
});
