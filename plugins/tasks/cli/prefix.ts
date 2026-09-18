export function allocatePrefix(
  base: string,
  used: ReadonlySet<string>,
): string | null {
  if (!used.has(base)) return base;
  for (let number = 2; number < 10_000; number += 1) {
    const suffix = String(number);
    const candidate = `${base.slice(0, 10 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return null;
}
