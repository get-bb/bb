export function parseSingleByteRange(
  value: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | undefined {
  const match = /^bytes=(\d*)-(\d*)$/iu.exec(value.trim());
  if (!match || (!match[1] && !match[2])) {
    return undefined;
  }
  const sizeBigInt = BigInt(size);
  if (!match[1]) {
    const suffix = BigInt(match[2]!);
    if (suffix === 0n || size === 0) {
      return "unsatisfiable";
    }
    return {
      start: suffix >= sizeBigInt ? 0 : size - Number(suffix),
      end: size - 1,
    };
  }
  const start = BigInt(match[1]);
  const end = match[2] ? BigInt(match[2]) : undefined;
  if (end !== undefined && end < start) {
    return undefined;
  }
  if (start >= sizeBigInt) {
    return "unsatisfiable";
  }
  return {
    start: Number(start),
    end: end === undefined || end >= sizeBigInt ? size - 1 : Number(end),
  };
}
