export class Lru<T> {
  private readonly map = new Map<string, T>();

  constructor(
    private readonly max: number,
    private readonly onEvict: (value: T, key: string) => void = () => undefined,
  ) {}

  get(key: string): T | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      const previous = this.map.get(key) as T;
      this.map.delete(key);
      if (previous !== value) this.onEvict(previous, key);
    }
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      const evicted = this.map.get(oldest) as T;
      this.map.delete(oldest);
      this.onEvict(evicted, oldest);
    }
  }
}
