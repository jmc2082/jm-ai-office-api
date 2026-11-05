import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { WORKER_CLASSES } from './index.js';
import type { BaseWorker } from './worker.base.js';

/** Looks up worker instances by slug. */
@Injectable()
export class WorkerRegistry {
  private readonly bySlug = new Map<string, BaseWorker>();

  constructor(moduleRef: ModuleRef) {
    for (const cls of WORKER_CLASSES) {
      const instance = moduleRef.get<BaseWorker>(cls, { strict: false });
      const { slug } = instance.definition;
      if (this.bySlug.has(slug))
        throw new Error(`Duplicate worker slug: ${slug}`);
      this.bySlug.set(slug, instance);
    }
  }

  get(slug: string): BaseWorker | undefined {
    return this.bySlug.get(slug);
  }

  all(): BaseWorker[] {
    return [...this.bySlug.values()];
  }
}
