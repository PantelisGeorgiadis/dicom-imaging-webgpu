import { Pipeline } from './Pipeline';

//#region PipelineCache
export class PipelineCache {
  private readonly cache: Map<string, Pipeline>;
  private readonly max: number;

  /**
   * Creates an instance of PipelineCache.
   */
  constructor(max: number) {
    this.max = max;
    this.cache = new Map();
  }

  /**
   * Gets a pipeline from the cache.
   */
  get(key: string): Pipeline | undefined {
    const item = this.cache.get(key);
    if (item) {
      this.cache.delete(key);
      this.cache.set(key, item);
    }

    return item;
  }

  /**
   * Sets a pipeline to the cache.
   */
  set(key: string, value: Pipeline): void {
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
