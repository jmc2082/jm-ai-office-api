import { HelloReviewerWorker } from './hello-reviewer/hello-reviewer.worker.js';
import { HelloWorldWorker } from './hello-world/hello-world.worker.js';
import { InboxTriageWorker } from './inbox-triage/inbox-triage.worker.js';
import { JokeOfTheDayWorker } from './joke-of-the-day/joke-of-the-day.worker.js';

/** Every worker with code behind it. Add new workers here. */
export const WORKER_CLASSES = [
  HelloWorldWorker,
  HelloReviewerWorker,
  JokeOfTheDayWorker,
  InboxTriageWorker,
];
