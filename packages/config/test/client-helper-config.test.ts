import { describe, expect, it } from "vitest";
import {
  formatClientHelperConfigPath,
  listClientHelperServerOrigins,
  normalizeClientHelperServerOrigin,
  parseClientHelperConfig,
  resolveClientHelperSshAuthority,
} from "../src/client-helper-config.js";

describe("client helper config", () => {
  it("normalizes server URLs to origins", () => {
    const config = parseClientHelperConfig({
      servers: {
        "https://bb.example.test/projects/proj_1": {
          hosts: {
            host_1: {
              sshAuthority: "devbox",
            },
          },
        },
      },
    });

    expect(listClientHelperServerOrigins(config)).toEqual([
      "https://bb.example.test",
    ]);
    expect(
      resolveClientHelperSshAuthority(config, {
        serverOrigin: "https://bb.example.test/thread/thr_1",
        hostId: "host_1",
      }),
    ).toBe("devbox");
  });

  it("returns null when no SSH authority is configured for a host", () => {
    const config = parseClientHelperConfig({
      servers: {
        "https://bb.example.test": {
          hosts: {
            host_1: {
              sshAuthority: "devbox",
            },
          },
        },
      },
    });

    expect(
      resolveClientHelperSshAuthority(config, {
        serverOrigin: "https://bb.example.test",
        hostId: "host_2",
      }),
    ).toBeNull();
  });

  it("rejects duplicate server origins after normalization", () => {
    expect(() =>
      parseClientHelperConfig({
        servers: {
          "https://bb.example.test/a": {
            hosts: {},
          },
          "https://bb.example.test/b": {
            hosts: {},
          },
        },
      }),
    ).toThrow(/Duplicate server origin/u);
  });

  it("rejects invalid server origins and SSH authorities", () => {
    expect(() => normalizeClientHelperServerOrigin("not a url")).toThrow(
      /Invalid server origin/u,
    );
    expect(() =>
      parseClientHelperConfig({
        servers: {
          "https://bb.example.test": {
            hosts: {
              host_1: {
                sshAuthority: "bad authority",
              },
            },
          },
        },
      }),
    ).toThrow();
  });

  it("formats the config path under the data dir", () => {
    expect(formatClientHelperConfigPath("/tmp/bb-data")).toBe(
      "/tmp/bb-data/client-helper.json",
    );
  });
});
