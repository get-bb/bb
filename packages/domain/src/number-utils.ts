type NumberInput = number | null | undefined;

export function toPositiveNumber(value: NumberInput): number | undefined {
  return value !== null &&
    value !== undefined &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : undefined;
}
