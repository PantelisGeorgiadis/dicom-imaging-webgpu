//#region Cache
export class Cache<T> {
  private readonly cache: Map<string, T>;
  private readonly max: number;

  /**
   * Creates an instance of Cache.
   */
  constructor(max: number) {
    this.max = max;
    this.cache = new Map();
  }

  /**
   * Gets an object from the cache.
   */
  get(key: string): T | undefined {
    const item = this.cache.get(key);
    if (item) {
      this.cache.delete(key);
      this.cache.set(key, item);
    }

    return item;
  }

  /**
   * Sets an object to the cache.
   */
  set(key: string, value: T): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size === this.max) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
}
//#endregion
