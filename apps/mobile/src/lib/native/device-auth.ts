import * as Crypto from "expo-crypto";
import {
  createDeviceAccessStore,
  createDeviceAuthRegistry,
  type DeviceAccessStore,
  type DeviceAuthRegistry,
  type DeviceCryptoDeps,
} from "../device-auth";
import { expoSecureStorage } from "./expo-secure-storage";
import { getProfileStore } from "./profile-store";

export const nativeDeviceCrypto: DeviceCryptoDeps = {
  async sha256(data) {
    return new Uint8Array(
      await Crypto.digest(
        Crypto.CryptoDigestAlgorithm.SHA256,
        new Uint8Array(data),
      ),
    );
  },
  randomId: () => Crypto.randomUUID(),
};

let store: DeviceAccessStore | null = null;
let registry: DeviceAuthRegistry | null = null;

export function getDeviceAccessStore(): DeviceAccessStore {
  store ??= createDeviceAccessStore(expoSecureStorage);
  return store;
}

export function getDeviceAuthRegistry(): DeviceAuthRegistry {
  if (registry === null) {
    const created = createDeviceAuthRegistry({
      store: getDeviceAccessStore(),
      crypto: nativeDeviceCrypto,
      baseFetch: (input, init) => fetch(input, init),
    });
    registry = created;
    const profiles = getProfileStore();
    const sync = (): void => {
      void created.sync(profiles.listProfiles());
    };
    profiles.subscribe(sync);
    sync();
  }
  return registry;
}
