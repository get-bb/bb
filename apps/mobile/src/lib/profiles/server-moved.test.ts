import { describe, expect, it, vi } from "vitest";
import { createProfileStore, profileStorageKey } from "./profile-store";
import { createMemorySecureStorage } from "./secure-storage";
import { createServerMovedProfileHandler } from "./server-moved";

const MOVED = {
  serverUrl: "https://studio.tailnet.ts.net",
  toHostName: "studio",
};

async function setup() {
  const storage = createMemorySecureStorage();
  let counter = 0;
  const store = createProfileStore({
    storage,
    now: () => 1_700_000_000_000,
    generateId: () => `id-${++counter}`,
  });
  const direct = await store.addProfile({
    mode: "direct",
    serverUrl: "http://192.168.1.20:38886",
    label: "Laptop",
  });
  const connect = await store.addProfile({
    mode: "connect",
    serverUrl: "https://laptop.getbb.app",
    label: "laptop",
    handle: "laptop",
    credential: "bbcm_secret",
  });
  const notify = vi.fn<(message: string) => void>();
  const handler = createServerMovedProfileHandler({ store, notify });
  return { connect, direct, handler, notify, storage, store };
}

describe("server moved profile handler", () => {
  it("points a direct profile at the new address and tells the user", async () => {
    const { direct, handler, notify, storage, store } = await setup();

    await expect(handler.handle(direct.id, MOVED)).resolves.toBe(true);

    expect(store.listProfiles().find((p) => p.id === direct.id)).toEqual({
      ...direct,
      serverUrl: "https://studio.tailnet.ts.net",
    });
    expect(
      JSON.parse(storage.entries.get(profileStorageKey(direct.id)) ?? "{}"),
    ).toMatchObject({ serverUrl: "https://studio.tailnet.ts.net" });
    expect(notify).toHaveBeenCalledExactlyOnceWith("Server moved to studio");
  });

  it("ignores connect profiles because their address does not change", async () => {
    const { connect, handler, notify, store } = await setup();

    await expect(handler.handle(connect.id, MOVED)).resolves.toBe(false);

    expect(store.listProfiles().find((p) => p.id === connect.id)).toEqual(
      connect,
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("updates once when several requests see the move at the same time", async () => {
    const { direct, handler, notify, store } = await setup();
    const updateProfile = vi.spyOn(store, "updateProfile");

    const results = await Promise.all([
      handler.handle(direct.id, MOVED),
      handler.handle(direct.id, MOVED),
      handler.handle(direct.id, MOVED),
    ]);

    expect(results).toEqual([true, false, false]);
    expect(updateProfile).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
  });

  it("ignores a removed profile", async () => {
    const { direct, handler, notify, store } = await setup();
    await store.removeProfile(direct.id);

    await expect(handler.handle(direct.id, MOVED)).resolves.toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps handling later moves after a failed update", async () => {
    const { direct, handler, notify, store } = await setup();
    vi.spyOn(store, "updateProfile").mockRejectedValueOnce(
      new Error("keychain locked"),
    );

    await expect(handler.handle(direct.id, MOVED)).rejects.toThrow(
      "keychain locked",
    );
    await expect(handler.handle(direct.id, MOVED)).resolves.toBe(true);
    expect(notify).toHaveBeenCalledOnce();
  });
});
