export class ByteBudgetCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private totalBytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly maxEntryBytes = maxBytes,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): void {
    this.delete(key);
    if (bytes > this.maxEntryBytes) return;
    this.entries.set(key, { value, bytes });
    this.totalBytes += bytes;
    for (const [oldestKey, oldest] of this.entries) {
      if (this.totalBytes <= this.maxBytes) break;
      this.entries.delete(oldestKey);
      this.totalBytes -= oldest.bytes;
    }
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (entry === undefined) return;
    this.entries.delete(key);
    this.totalBytes -= entry.bytes;
  }
}
