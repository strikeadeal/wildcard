export function reconnectDelay(attempt: number): number {
  if (attempt <= 0) return 0;
  return Math.min(8000, 1000 * 2 ** (attempt - 1));
}

export class ReconnectGate {
  private settle: ((outcome: 'ready' | 'cancelled') => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  wait(delayMs: number, online: boolean): Promise<'ready' | 'cancelled'> {
    this.cancel();
    return new Promise((resolve) => {
      this.settle = resolve;
      if (online) this.timer = setTimeout(() => this.finish('ready'), delayMs);
    });
  }

  wake(): void {
    this.finish('ready');
  }

  cancel(): void {
    this.finish('cancelled');
  }

  private finish(outcome: 'ready' | 'cancelled'): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const settle = this.settle;
    this.settle = null;
    settle?.(outcome);
  }
}
