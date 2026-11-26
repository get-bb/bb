import {
  createPushStore,
  createPushSubscriptionsApi,
  type PushStore,
  type PushSubscriptionsApi,
} from "@/data/notifications";
import { getDeviceAuthRegistry } from "@/lib/native/device-auth";
import { getPreferencesStorage } from "@/lib/native/preferences-storage";
import { createMobileFetch } from "@/lib/sdk/mobile-fetch";

let store: PushStore | null = null;
let api: PushSubscriptionsApi | null = null;

export function getPushStore(): PushStore {
  store ??= createPushStore(getPreferencesStorage());
  return store;
}

export function getPushSubscriptionsApi(): PushSubscriptionsApi {
  api ??= createPushSubscriptionsApi(
    createMobileFetch((input, init) =>
      getDeviceAuthRegistry().fetch(input, init),
    ),
  );
  return api;
}
