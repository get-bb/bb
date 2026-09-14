export function perDbRegistry<T>(
  registry: WeakMap<object, Map<string, T>>,
  db: object,
): Map<string, T> {
  let map = registry.get(db);
  if (map === undefined) {
    map = new Map();
    registry.set(db, map);
  }
  return map;
}
