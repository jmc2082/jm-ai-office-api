export type Job = () => Promise<void>;

/**
 * Minimal FIFO concurrency limiter. Keeps heavy jobs (Playwright, Claude Code)
 * from all running at once on a small box. In-process only (roadmap §9 lists
 * when to replace it).
 */
export class JobQueue {
  private active = 0;
  private readonly pending: Job[] = [];
  private idleResolvers: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly onError: (err: unknown) => void = () => {},
  ) {
    if (concurrency < 1) throw new Error('concurrency must be >= 1');
  }

  add(job: Job): void {
    this.pending.push(job);
    this.drain();
  }

  get size() {
    return { active: this.active, pending: this.pending.length };
  }

  /** Resolves once nothing is running or waiting. */
  onIdle(): Promise<void> {
    if (this.active === 0 && this.pending.length === 0)
      return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private drain(): void {
    while (this.active < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.active++;
      Promise.resolve()
        .then(job)
        .catch(this.onError)
        .finally(() => {
          this.active--;
          this.drain();
          if (this.active === 0 && this.pending.length === 0) {
            const resolvers = this.idleResolvers;
            this.idleResolvers = [];
            resolvers.forEach((r) => r());
          }
        });
    }
  }
}
