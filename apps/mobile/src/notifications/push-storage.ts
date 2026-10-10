import {
  createPushStore,
  createPushSubscriptionsApi,
  type PushStore,
  type PushSubscriptionsApi,
} from "@/data/notifications";
import { getPreferencesStorage } from "@/lib/native/preferences-storage";
import { profileFetchForServer } from "@/app-shell/profile-fetch";

let store: PushStore | null = null;
let api: PushSubscriptionsApi | null = null;

export function getPushStore(): PushStore {
  store ??= createPushStore(getPreferencesStorage());
  return store;
}

export function getPushSubscriptionsApi(): PushSubscriptionsApi {
  api ??= createPushSubscriptionsApi(profileFetchForServer);
  return api;
}
