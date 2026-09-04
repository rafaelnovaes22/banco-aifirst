interface WindowCounter {
  count: number;
  resetAt: number;
}

export class FixedWindowRateLimiter {
  private readonly counters = new Map<string, WindowCounter>();

  public constructor(
    private readonly maximum: number,
    private readonly windowInMs: number,
  ) {}

  public consume(
    key: string,
    now: Date,
  ): { allowed: boolean; retryAfterSeconds: number } {
    const current = this.counters.get(key);
    if (!current || current.resetAt <= now.getTime())
      return this.startWindow(key, now);
    current.count += 1;
    return {
      allowed: current.count <= this.maximum,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((current.resetAt - now.getTime()) / 1_000),
      ),
    };
  }

  private startWindow(
    key: string,
    now: Date,
  ): { allowed: boolean; retryAfterSeconds: number } {
    this.prune(now);
    this.counters.set(key, {
      count: 1,
      resetAt: now.getTime() + this.windowInMs,
    });
    return {
      allowed: true,
      retryAfterSeconds: Math.ceil(this.windowInMs / 1_000),
    };
  }

  private prune(now: Date): void {
    if (this.counters.size < 5_000) return;
    for (const [key, counter] of this.counters) {
      if (counter.resetAt <= now.getTime()) this.counters.delete(key);
    }
  }
}
