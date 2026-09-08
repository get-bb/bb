import { describe, expect, it } from "vitest";
import {
  parseSshHostAliases,
  readSshHostAliases,
  type SshConfigFileSystem,
} from "./ssh-config.js";

describe("SSH config aliases", () => {
  it("parses concrete Host aliases and excludes wildcard and negated patterns", () => {
    expect(
      parseSshHostAliases(`
Host buildbox gpu
  HostName build.example.com
Host *.corp !bastion wildcard?
Host "quoted-host" # comment
`),
    ).toEqual(["buildbox", "gpu", "quoted-host"]);
  });

  it("follows exact and one-directory wildcard Include entries", async () => {
    const files = new Map([
      [
        "/home/test/.ssh/config",
        "Include config.d/*\nInclude extra.conf\nHost root-host\n",
      ],
      ["/home/test/.ssh/config.d/one", "Host included-one\n"],
      ["/home/test/.ssh/config.d/two", "Host included-two\n"],
      ["/home/test/.ssh/extra.conf", "Host exact-include\n"],
    ]);
    const fileSystem: SshConfigFileSystem = {
      homeDir: "/home/test",
      read: async (path) => {
        const value = files.get(path);
        if (value === undefined) throw new Error("not found");
        return value;
      },
      list: async (path) =>
        path === "/home/test/.ssh/config.d" ? ["two", "one"] : [],
    };

    await expect(readSshHostAliases(fileSystem)).resolves.toEqual([
      "exact-include",
      "included-one",
      "included-two",
      "root-host",
    ]);
  });

  it("returns no aliases when config is absent", async () => {
    await expect(
      readSshHostAliases({
        homeDir: "/missing",
        read: async () => {
          throw new Error("not found");
        },
        list: async () => [],
      }),
    ).resolves.toEqual([]);
  });
});

it("expands directory globs, bracket classes, home paths and root-relative nested Includes", async () => {
  const files = new Map([
    [
      "/home/test/.ssh/config",
      "Include=groups/*/host[12].conf\nInclude ~/extra.conf\nHost=root",
    ],
    [
      "/home/test/.ssh/groups/team/host1.conf",
      "Host nested\nInclude shared.conf",
    ],
    ["/home/test/.ssh/groups/team/host2.conf", "Host second\nInclude config"],
    ["/home/test/.ssh/shared.conf", "Host root-relative"],
    ["/home/test/extra.conf", "Host home-relative"],
  ]);
  const fileSystem: SshConfigFileSystem = {
    homeDir: "/home/test",
    async read(path) {
      const value = files.get(path);
      if (value === undefined) throw new Error("missing");
      return value;
    },
    async list(path) {
      if (path === "/home/test/.ssh/groups") return ["team", ".hidden"];
      if (path === "/home/test/.ssh/groups/team")
        return ["host3.conf", "host2.conf", "host1.conf"];
      return [];
    },
  };
  expect(await readSshHostAliases(fileSystem)).toEqual([
    "home-relative",
    "nested",
    "root",
    "root-relative",
    "second",
  ]);
});
