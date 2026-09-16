export class SlidingMedian {
  private lo: number[] = []; // max-heap (store negatives for simplicity via comparator)
  private hi: number[] = []; // min-heap
  private delayed = new Map<number, number>();
  private loSize = 0;
  private hiSize = 0;

  private pushHeap(heap: number[], v: number, isMax: boolean): void {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const needSwap = isMax ? heap[i] > heap[p] : heap[i] < heap[p];
      if (!needSwap) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  }

  private popHeap(heap: number[], isMax: boolean): number {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let best = i;
        if (l < heap.length && (isMax ? heap[l] > heap[best] : heap[l] < heap[best])) best = l;
        if (r < heap.length && (isMax ? heap[r] > heap[best] : heap[r] < heap[best])) best = r;
        if (best === i) break;
        [heap[i], heap[best]] = [heap[best], heap[i]];
        i = best;
      }
    }
    return top;
  }

  private prune(isMax: boolean): void {
    const heap = isMax ? this.lo : this.hi;
    while (heap.length > 0) {
      const top = heap[0];
      const d = this.delayed.get(top);
      if (d === undefined) break;
      if (d === 1) this.delayed.delete(top);
      else this.delayed.set(top, d - 1);
      this.popHeap(heap, isMax);
    }
  }

  private rebalance(): void {
    if (this.loSize > this.hiSize + 1) {
      this.pushHeap(this.hi, this.popHeap(this.lo, true), false);
      this.loSize--;
      this.hiSize++;
      this.prune(true);
    } else if (this.loSize < this.hiSize) {
      this.pushHeap(this.lo, this.popHeap(this.hi, false), true);
      this.loSize++;
      this.hiSize--;
      this.prune(false);
    }
  }

  insert(v: number): void {
    if (this.lo.length === 0 || v <= this.lo[0]) {
      this.pushHeap(this.lo, v, true);
      this.loSize++;
    } else {
      this.pushHeap(this.hi, v, false);
      this.hiSize++;
    }
    this.rebalance();
  }

  remove(v: number): void {
    this.delayed.set(v, (this.delayed.get(v) ?? 0) + 1);
    if (v <= this.lo[0]) {
      this.loSize--;
      if (v === this.lo[0]) this.prune(true);
    } else {
      this.hiSize--;
      if (this.hi.length > 0 && v === this.hi[0]) this.prune(false);
    }
    this.rebalance();
  }

  median(): number {
    if (this.loSize > this.hiSize) return this.lo[0];
    return (this.lo[0] + this.hi[0]) / 2;
  }
}

export function mad(values: number[], median: number): number {
  const dev = values.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const n = dev.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? dev[(n - 1) / 2] : (dev[n / 2 - 1] + dev[n / 2]) / 2;
}

export interface Anomaly {
  hour: number;
  residual: number;
  median: number;
  mad: number;
}

export function detectAnomalies(residual: Float64Array | number[], window = 168, k = 3): Anomaly[] {
  const out: Anomaly[] = [];
  const med = new SlidingMedian();
  const buf: number[] = [];

  for (let h = 0; h < residual.length; h++) {
    buf.push(residual[h]);
    med.insert(residual[h]);
    
    if (buf.length > window) {
      med.remove(buf.shift()!);
    }
    if (buf.length === window) {
      const m = med.median();
      const d = mad(buf, m);
      if (residual[h] > m + k * d) out.push({ hour: h, residual: residual[h], median: m, mad: d });
    }
  }
  return out;
}
