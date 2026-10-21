import { describe, expect, it } from "vitest";
import { loadServerConfig } from "../src/server.js";

describe("BB_HOLDOUT_FORCE", () => {
  it.each(["control", "test"])("parses %s at the server boundary", (arm) => {
    expect(
      loadServerConfig({
        mode: "prod",
        env: {
          BB_DATA_DIR: "/tmp/bb-holdout-config",
          BB_SERVER_PORT: "49001",
          BB_HOST_DAEMON_PORT: "49002",
          BB_HOLDOUT_FORCE: `app_aa_check:${arm}`,
        },
      }).BB_HOLDOUT_FORCE,
    ).toEqual({ key: "app_aa_check", arm });
  });
  it.each([
    "app_aa_check:other",
    "other:test",
    "app_aa_check:test:extra",
    "app_aa_check",
    "app_aa_check:Test",
  ])("rejects %s", (value) => {
    expect(() =>
      loadServerConfig({
        mode: "prod",
        env: {
          BB_DATA_DIR: "/tmp/bb-holdout-config",
          BB_SERVER_PORT: "49001",
          BB_HOST_DAEMON_PORT: "49002",
          BB_HOLDOUT_FORCE: value,
        },
      }),
    ).toThrow();
  });
  it("defaults to no force", () => {
    expect(
      loadServerConfig({
        mode: "prod",
        env: {
          BB_DATA_DIR: "/tmp/bb-holdout-config",
          BB_SERVER_PORT: "49001",
          BB_HOST_DAEMON_PORT: "49002",
        },
      }).BB_HOLDOUT_FORCE,
    ).toBeNull();
  });
});
