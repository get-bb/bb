import { describe, expect, it } from "vitest";
import {
  buildDesktopServerChoices,
  customServerId,
} from "../src/server-list.js";
import {
  BUILTIN_SERVER_NAME,
  createServerTargetStore,
} from "../src/server-target.js";

const LOCAL_URL = "http://127.0.0.1:38886";

function createStore() {
  return createServerTargetStore({
    storagePath: "/test/server-target.json",
    fs: {
      mkdir: async () => undefined,
      readFile: async () => "",
      writeFile: async () => undefined,
    },
  });
}

describe("buildDesktopServerChoices", () => {
  it("lists each account server once by hostname after adopting saved custom URLs", async () => {
    const store = createStore();
    const servers = [
      { handle: "brsbl", name: "default", url: "https://brsbl.getbb.app" },
      {
        handle: "brsbl-bbox",
        name: "brsbl-bbox",
        url: "https://brsbl-bbox.getbb.app",
      },
    ];
    await store.setConnectServer(servers[0]);
    await store.setCustomServerUrl("https://brsbl.getbb.app");
    await store.setCustomServerUrl("https://brsbl-bbox.getbb.app");
    await store.setCustomServerUrl("https://bb.example.com/team");

    await store.adoptConnectServers(servers);

    expect(buildDesktopServerChoices(store, servers, LOCAL_URL)).toEqual([
      {
        id: "builtin",
        name: BUILTIN_SERVER_NAME,
        origin: LOCAL_URL,
        kind: "local",
        active: false,
      },
      {
        id: "connect:brsbl",
        name: "brsbl.getbb.app",
        origin: "https://brsbl.getbb.app",
        kind: "account",
        active: false,
      },
      {
        id: "connect:brsbl-bbox",
        name: "brsbl-bbox.getbb.app",
        origin: "https://brsbl-bbox.getbb.app",
        kind: "account",
        active: false,
      },
      {
        id: customServerId("https://bb.example.com/team"),
        name: "bb.example.com",
        origin: "https://bb.example.com",
        kind: "custom",
        active: true,
      },
    ]);
  });

  it("labels account servers by their saved name, keeping a renamed custom URL's name", async () => {
    const store = createStore();
    const servers = [
      { handle: "brsbl", name: "default", url: "https://brsbl.getbb.app" },
      {
        handle: "brsbl-bbox",
        name: "brsbl-bbox",
        url: "https://brsbl-bbox.getbb.app",
      },
    ];
    await store.setCustomServerUrl("https://brsbl-bbox.getbb.app", {
      name: "Devbox",
    });
    await store.setConnectServerName("brsbl", "  Studio   Mac ");

    await store.adoptConnectServers(servers);

    expect(buildDesktopServerChoices(store, servers, LOCAL_URL)).toEqual([
      {
        id: "builtin",
        name: BUILTIN_SERVER_NAME,
        origin: LOCAL_URL,
        kind: "local",
        active: false,
      },
      {
        id: "connect:brsbl",
        name: "Studio Mac",
        origin: "https://brsbl.getbb.app",
        kind: "account",
        active: false,
      },
      {
        id: "connect:brsbl-bbox",
        name: "Devbox",
        origin: "https://brsbl-bbox.getbb.app",
        kind: "account",
        active: true,
      },
    ]);

    await store.setConnectServerName("brsbl-bbox", null);
    expect(buildDesktopServerChoices(store, servers, LOCAL_URL)[2]).toEqual({
      id: "connect:brsbl-bbox",
      name: "brsbl-bbox.getbb.app",
      origin: "https://brsbl-bbox.getbb.app",
      kind: "account",
      active: true,
    });
  });
});
