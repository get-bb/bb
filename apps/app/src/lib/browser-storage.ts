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
  const browserWindow = globalThis.window;
  if (browserWindow === undefined) {
    return null;
  }
  return browserWindow.localStorage;
}

function getSessionStorage(): Storage | null {
  const browserWindow = globalThis.window;
  if (browserWindow === undefined) {
    return null;
  }
  return browserWindow.sessionStorage;
}

function subscribeToLocalStorageKey(
  key: string,
  callback: StoredValueListener,
): () => void {
  const localStorage = getLocalStorage();
  const browserWindow = globalThis.window;
  if (!localStorage || browserWindow === undefined) {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && event.key === key) {
      callback(event.newValue);
    }
  };

  browserWindow.addEventListener("storage", handleStorage);
  return () => {
    browserWindow.removeEventListener("storage", handleStorage);
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
        /* SAFETY: JSON storage callers select the matching generic type for this codec. */
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

export function createTabScopedStorage<T>(
  codec: StoredValueCodec<T>,
): SyncStorage<T> {
  return {
    getItem: (key: string, initialValue: T) => {
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
