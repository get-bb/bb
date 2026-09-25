import { describe, expect, it } from "vitest";
import { buildDesktopServerList, customServerId } from "../src/server-list.js";
import { BUILTIN_SERVER_NAME } from "../src/server-target.js";

const LAPTOP = {
  handle: "laptop",
  name: "Laptop",
  url: "https://laptop.getbb.app",
};

const CUSTOM_SERVERS = [
  { name: "ops", url: "http://10.0.0.3:38886" },
  { name: null, url: "http://10.0.0.4:38886" },
];

function summarize(
  entries: ReturnType<typeof buildDesktopServerList>,
): Array<[string, string, boolean]> {
  return entries.map((entry) => [entry.kind, entry.name, entry.active]);
}

describe("buildDesktopServerList", () => {
  it("lists the built-in server, Connect, and saved servers with names or hosts", () => {
    const entries = buildDesktopServerList({
      connectServers: [LAPTOP],
      customServers: CUSTOM_SERVERS,
      showBuiltinServer: true,
      target: { kind: "custom", url: "http://10.0.0.4:38886" },
    });

    expect(summarize(entries)).toEqual([
      ["builtin", BUILTIN_SERVER_NAME, false],
      ["connect", "Laptop", false],
      ["custom", "ops", false],
      ["custom", "10.0.0.4:38886", true],
    ]);
    expect(entries[3]?.customUrl).toBe("http://10.0.0.4:38886");
    expect(entries[1]?.connectServer).toEqual(LAPTOP);
  });

  it("hides the built-in server only while another server is selected", () => {
    const hidden = buildDesktopServerList({
      connectServers: [],
      customServers: CUSTOM_SERVERS,
      showBuiltinServer: false,
      target: { kind: "custom", url: "http://10.0.0.3:38886" },
    });
    expect(summarize(hidden)).toEqual([
      ["custom", "ops", true],
      ["custom", "10.0.0.4:38886", false],
    ]);

    const builtinActive = buildDesktopServerList({
      connectServers: [],
      customServers: CUSTOM_SERVERS,
      showBuiltinServer: false,
      target: { kind: "builtin" },
    });
    expect(builtinActive[0]).toMatchObject({ active: true, kind: "builtin" });

    const onlyBuiltin = buildDesktopServerList({
      connectServers: [],
      customServers: [],
      showBuiltinServer: false,
      target: { kind: "builtin" },
    });
    expect(summarize(onlyBuiltin)).toEqual([
      ["builtin", BUILTIN_SERVER_NAME, true],
    ]);
  });

  it("uses stable ids that do not reveal saved URLs", () => {
    const id = customServerId("http://10.0.0.3:38886");
    expect(id).toBe(customServerId("http://10.0.0.3:38886"));
    expect(id).not.toBe(customServerId("http://10.0.0.4:38886"));
    expect(id).toMatch(/^custom:[0-9a-f]{16}$/u);
    expect(id).not.toContain("10.0.0.3");
  });
});
