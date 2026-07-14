export interface MemoryTtlCacheOptions {
  readonly ttlMs: number;
  readonly maxEntries: number;
  readonly now?: () => number;
}

export class MemoryTtlCache<T> {
  private readonly entries = new Map<string, { readonly value: T; readonly expiresAt: number }>();
  private readonly now: () => number;

  constructor(private readonly options: MemoryTtlCacheOptions) {
    if (!Number.isInteger(options.ttlMs) || options.ttlMs < 1) {
      throw new Error("ttlMs must be a positive integer");
    }
    if (!Number.isInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new Error("maxEntries must be a positive integer");
    }
    this.now = options.now ?? Date.now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    while (this.entries.size >= this.options.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.options.ttlMs });
  }
}
