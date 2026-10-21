const BYTES_PER_UNIT = 1024;

export function formatByteSize(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) {
    return `${bytes} B`;
  }
  const kb = bytes / BYTES_PER_UNIT;
  if (kb < BYTES_PER_UNIT) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = kb / BYTES_PER_UNIT;
  if (mb < BYTES_PER_UNIT) {
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  const gb = mb / BYTES_PER_UNIT;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}
