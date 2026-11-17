import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { WORKER_CLASSES } from './index.js';
import type { BaseWorker } from './worker.base.js';

/** Looks up worker instances by slug. */
@Injectable()
export class WorkerRegistry {
  private cache?: Map<string, BaseWorker>;

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Built on first use, not in the constructor: workers that inject their own
   * services (DB, API clients) may not be instantiated yet when this is constructed.
   */
  private get bySlug(): Map<string, BaseWorker> {
    if (this.cache) return this.cache;
    const map = new Map<string, BaseWorker>();
    for (const cls of WORKER_CLASSES) {
      const instance = this.moduleRef.get<BaseWorker>(cls, { strict: false });
      const { slug } = instance.definition;
      if (map.has(slug)) throw new Error(`Duplicate worker slug: ${slug}`);
      map.set(slug, instance);
    }
    return (this.cache = map);
  }

  get(slug: string): BaseWorker | undefined {
    return this.bySlug.get(slug);
  }

  all(): BaseWorker[] {
    return [...this.bySlug.values()];
  }
}
