import { HelloReviewerWorker } from './hello-reviewer/hello-reviewer.worker.js';
import { HelloWorldWorker } from './hello-world/hello-world.worker.js';

/** Every worker with code behind it. Add new workers here. */
export const WORKER_CLASSES = [HelloWorldWorker, HelloReviewerWorker];
