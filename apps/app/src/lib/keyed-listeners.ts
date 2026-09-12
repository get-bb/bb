type KeyedListener = () => void;

interface KeyedListeners<Key> {
  subscribe(key: Key, listener: KeyedListener): () => void;
  notify(key: Key): void;
  notifyAll(): void;
}

export function createKeyedListeners<Key>(): KeyedListeners<Key> {
  const listenersByKey = new Map<Key, Set<KeyedListener>>();
  return {
    subscribe(key, listener) {
      let listeners = listenersByKey.get(key);
      if (!listeners) {
        listeners = new Set();
        listenersByKey.set(key, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          listenersByKey.delete(key);
        }
      };
    },
    notify(key) {
      const listeners = listenersByKey.get(key);
      if (!listeners) return;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    notifyAll() {
      for (const listeners of listenersByKey.values()) {
        for (const listener of [...listeners]) {
          listener();
        }
      }
    },
  };
}
