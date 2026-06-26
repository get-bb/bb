import { describe, expect, it } from "vitest";
import {
  formatClientConfigPath,
  listClientServerOrigins,
  normalizeClientServerOrigin,
  parseClientConfig,
  resolveClientSshAuthority,
} from "../src/client-config.js";

describe("client config", () => {
  it("normalizes server URLs to origins", () => {
    const config = parseClientConfig({
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

    expect(listClientServerOrigins(config)).toEqual([
      "https://bb.example.test",
    ]);
    expect(
      resolveClientSshAuthority(config, {
        serverOrigin: "https://bb.example.test/thread/thr_1",
        hostId: "host_1",
      }),
    ).toBe("devbox");
  });

  it("returns null when no SSH target is configured for a host", () => {
    const config = parseClientConfig({
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
      resolveClientSshAuthority(config, {
        serverOrigin: "https://bb.example.test",
        hostId: "host_2",
      }),
    ).toBeNull();
  });

  it("rejects duplicate server origins after normalization", () => {
    expect(() =>
      parseClientConfig({
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
    expect(() => normalizeClientServerOrigin("not a url")).toThrow(
      /Invalid server origin/u,
    );
    expect(() =>
      parseClientConfig({
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
    expect(formatClientConfigPath("/tmp/bb-data")).toBe(
      "/tmp/bb-data/client.json",
    );
  });
});
