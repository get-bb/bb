import {
  createSealedDeviceIdentityStore,
  type SealedDeviceIdentityStore,
} from "../sealed/device-identity";
import { expoSecureStorage } from "./expo-secure-storage";

let instance: SealedDeviceIdentityStore | null = null;

export function getSealedDeviceIdentityStore(): SealedDeviceIdentityStore {
  instance ??= createSealedDeviceIdentityStore(expoSecureStorage);
  return instance;
}
