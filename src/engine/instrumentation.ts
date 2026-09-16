export interface PerfSnapshot {
  inp: number | null;
  inpBreakdown: { inputDelay: number; processing: number; presentation: number } | null;
  longTasks: number;
  longTasksTotalMs: number;
  processingMs: number | null;
}

export class Instrumentation {
  private longTasks = 0;
  private longTasksTotalMs = 0;
  private inp: number | null = null;
  private inpBreakdown: PerfSnapshot['inpBreakdown'] = null;
  private processingMs: number | null = null;
  private processingStart = 0;
  private observers: PerformanceObserver[] = [];
  private listeners = new Set<() => void>();

  start(): void {
    try {
      const longtask = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          this.longTasks++;
          this.longTasksTotalMs += (e as PerformanceEntry & { duration: number }).duration;
        }
        this.emit();
      });
      longtask.observe({ type: 'longtask', buffered: true });
      this.observers.push(longtask);
    } catch {
    }

    try {
      const inp = new PerformanceObserver((list) => {
        const entries = list.getEntries() as (PerformanceEntry & {
          duration: number;
          processingStart?: number;
          processingEnd?: number;
          startTime: number;
        })[];
        
        for (const e of entries) {
          const processingStart = e.processingStart ?? e.startTime;
          const processingEnd = e.processingEnd ?? e.startTime + e.duration;
          this.inp = e.duration;
          this.inpBreakdown = {
            inputDelay: Math.max(0, processingStart - e.startTime),
            processing: Math.max(0, processingEnd - processingStart),
            presentation: Math.max(0, e.startTime + e.duration - processingEnd),
          };
        }
        this.emit();
      });
      inp.observe({ type: 'event', buffered: true });
      this.observers.push(inp);
    } catch {
    }
  }

  beginProcessing(): void {
    this.processingStart = performance.now();
  }

  endProcessing(): void {
    this.processingMs = performance.now() - this.processingStart;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  snapshot(): PerfSnapshot {
    return {
      inp: this.inp,
      inpBreakdown: this.inpBreakdown,
      longTasks: this.longTasks,
      longTasksTotalMs: this.longTasksTotalMs,
      processingMs: this.processingMs,
    };
  }

  stop(): void {
    for (const o of this.observers) o.disconnect();
    this.observers = [];
  }
}
