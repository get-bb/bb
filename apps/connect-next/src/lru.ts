export interface LruOptions<V> {
  maxEntries: number;
  maxBytes: number;
  sizeOf(value: V): number;
  onDelete?: (key: string, value: V) => void;
}

interface Slot<V> {
  value: V;
  expiresAt: number;
  size: number;
}

export class Lru<V> {
  private readonly slots = new Map<string, Slot<V>>();
  private bytes = 0;

  constructor(private readonly options: LruOptions<V>) {}

  get size(): number {
    return this.slots.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  get(key: string, now: number): V | undefined {
    const slot = this.slots.get(key);
    if (slot === undefined) return undefined;
    if (slot.expiresAt <= now) {
      this.delete(key);
      return undefined;
    }
    this.slots.delete(key);
    this.slots.set(key, slot);
    return slot.value;
  }

  peek(key: string): V | undefined {
    return this.slots.get(key)?.value;
  }

  set(key: string, value: V, expiresAt: number): void {
    const size = this.options.sizeOf(value);
    this.delete(key);
    if (size > this.options.maxBytes) return;
    this.slots.set(key, { value, expiresAt, size });
    this.bytes += size;
    for (const oldest of this.slots.keys()) {
      if (
        this.slots.size <= this.options.maxEntries &&
        this.bytes <= this.options.maxBytes
      ) {
        break;
      }
      this.delete(oldest);
    }
  }

  delete(key: string): void {
    const slot = this.slots.get(key);
    if (slot === undefined) return;
    this.slots.delete(key);
    this.bytes -= slot.size;
    this.options.onDelete?.(key, slot.value);
  }
}
