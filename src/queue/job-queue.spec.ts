import { JobQueue } from './job-queue.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe('JobQueue', () => {
  it('never runs more than `concurrency` jobs at once', async () => {
    const q = new JobQueue(2);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, deferred);
    gates.forEach((g) =>
      q.add(async () => {
        running++;
        peak = Math.max(peak, running);
        await g.promise;
        running--;
      }),
    );
    await Promise.resolve();
    expect(q.size).toEqual({ active: 2, pending: 3 });
    gates.forEach((g) => g.resolve());
    await q.onIdle();
    expect(peak).toBe(2);
    expect(q.size).toEqual({ active: 0, pending: 0 });
  });

  it('keeps going after a job throws', async () => {
    const errors: unknown[] = [];
    const q = new JobQueue(1, (e) => errors.push(e));
    const done: number[] = [];
    q.add(async () => {
      throw new Error('boom');
    });
    q.add(async () => {
      done.push(2);
    });
    await q.onIdle();
    expect(errors).toHaveLength(1);
    expect(done).toEqual([2]);
  });
});
