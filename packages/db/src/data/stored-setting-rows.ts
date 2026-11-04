export interface StoredSettingRow {
  key: string;
  value: string;
}

export function sameStoredSettingRows(
  left: readonly StoredSettingRow[],
  right: readonly StoredSettingRow[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.key === right[index]!.key && row.value === right[index]!.value,
    )
  );
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
