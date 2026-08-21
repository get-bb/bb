import { atomWithStorage } from "jotai/utils";

type StringValueGuard<T extends string> = (value: string) => value is T;
type StoredValueListener = (storedValue: string | null) => void;

export interface SyncStorage<T> {
  getItem: (key: string, initialValue: T) => T;
  setItem: (key: string, newValue: T) => void;
  removeItem: (key: string) => void;
  subscribe?: (
    key: string,
    callback: (value: T) => void,
    initialValue: T,
  ) => (() => void) | undefined;
}

interface SyncStringStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, newValue: string) => void;
  removeItem: (key: string) => void;
  subscribe?: (
    key: string,
    callback: StoredValueListener,
  ) => (() => void) | undefined;
}

interface StoredValueCodec<T> {
  parse: (storedValue: string | null, initialValue: T) => T;
  serialize: (value: T) => string;
}

export function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.sessionStorage;
}

function subscribeToLocalStorageKey(
  key: string,
  callback: StoredValueListener,
): () => void {
  const localStorage = getLocalStorage();
  if (
    !localStorage ||
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && event.key === key) {
      callback(event.newValue);
    }
  };

  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener("storage", handleStorage);
  };
}

const localStorageStringStorage: SyncStringStorage = {
  getItem: (key: string) => getLocalStorage()?.getItem(key) ?? null,
  setItem: (key: string, value: string) => {
    getLocalStorage()?.setItem(key, value);
  },
  removeItem: (key: string) => {
    getLocalStorage()?.removeItem(key);
  },
  subscribe: (key: string, callback: StoredValueListener) =>
    subscribeToLocalStorageKey(key, callback),
};

export const rawStringLocalStorage = createLocalStorageSyncStorage<string>({
  parse: (storedValue, initialValue) => storedValue ?? initialValue,
  serialize: (value) => value,
});

export function createJsonLocalStorage<T>(): SyncStorage<T> {
  return createLocalStorageSyncStorage<T>({
    parse: (storedValue, initialValue) => {
      if (storedValue === null) {
        return initialValue;
      }

      try {
        return JSON.parse(storedValue) as T;
      } catch {
        return initialValue;
      }
    },
    serialize: (value) => JSON.stringify(value),
  });
}

export function createBooleanPreferenceAtom(
  storageKey: string,
  defaultValue: boolean,
) {
  return atomWithStorage<boolean>(
    storageKey,
    defaultValue,
    createJsonLocalStorage<boolean>(),
    { getOnInit: true },
  );
}

/**
 * Storage for state that belongs to one tab rather than to the user, such as
 * the split workspace layout.
 *
 * Reads prefer `sessionStorage` (per tab, survives that tab's reload) and fall
 * back to `localStorage` so a newly opened tab still starts from the most
 * recent arrangement. Writes go to both. There is deliberately no `storage`
 * subscription: that event fires in *other* tabs, so subscribing would make one
 * tab adopt another tab's value mid-session — the cross-tab thread bleed in
 * issue #873.
 */
export function createTabScopedStorage<T>(
  codec: StoredValueCodec<T>,
): SyncStorage<T> {
  return {
    getItem: (key: string, initialValue: T) => {
      // An empty-but-present tab value is a real value (a cleared layout
      // serializes to ""), so only a missing key falls back to the seed.
      const tabValue = getSessionStorage()?.getItem(key) ?? null;
      const storedValue = tabValue ?? getLocalStorage()?.getItem(key) ?? null;
      return codec.parse(storedValue, initialValue);
    },
    setItem: (key: string, value: T) => {
      const serialized = codec.serialize(value);
      getSessionStorage()?.setItem(key, serialized);
      getLocalStorage()?.setItem(key, serialized);
    },
    removeItem: (key: string) => {
      getSessionStorage()?.removeItem(key);
      getLocalStorage()?.removeItem(key);
    },
  };
}

export function createLocalStorageSyncStorage<T>(
  codec: StoredValueCodec<T>,
): SyncStorage<T> {
  return {
    getItem: (key: string, initialValue: T) =>
      codec.parse(localStorageStringStorage.getItem(key), initialValue),
    setItem: (key: string, value: T) => {
      localStorageStringStorage.setItem(key, codec.serialize(value));
    },
    removeItem: (key: string) => {
      localStorageStringStorage.removeItem(key);
    },
    subscribe: (key: string, callback: (value: T) => void, initialValue: T) =>
      subscribeToLocalStorageKey(key, (storedValue) => {
        callback(codec.parse(storedValue, initialValue));
      }),
  };
}

export function createLocalStorageEnumStorage<T extends string>(
  isValue: StringValueGuard<T>,
): SyncStorage<T> {
  return createLocalStorageSyncStorage<T>({
    parse: (storedValue, initialValue) =>
      storedValue !== null && isValue(storedValue) ? storedValue : initialValue,
    serialize: (value) => value,
  });
}

export function createNullableLocalStorageEnumStorage<T extends string>(
  isValue: StringValueGuard<T>,
): SyncStorage<T | null> {
  return {
    getItem: (key: string, initialValue: T | null) => {
      const storedValue = localStorageStringStorage.getItem(key);
      return storedValue !== null && isValue(storedValue)
        ? storedValue
        : initialValue;
    },
    setItem: (key: string, value: T | null) => {
      if (value === null) {
        localStorageStringStorage.removeItem(key);
        return;
      }
      localStorageStringStorage.setItem(key, value);
    },
    removeItem: (key: string) => {
      localStorageStringStorage.removeItem(key);
    },
    subscribe: (
      key: string,
      callback: (value: T | null) => void,
      initialValue: T | null,
    ) =>
      subscribeToLocalStorageKey(key, (storedValue) => {
        callback(
          storedValue !== null && isValue(storedValue)
            ? storedValue
            : initialValue,
        );
      }),
  };
}
