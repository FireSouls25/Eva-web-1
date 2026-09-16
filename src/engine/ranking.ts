export interface Scored {
  id: string;
  score: number;
}

export class TopK {
  private heap: Scored[] = [];
  constructor(private k: number) {}

  push(item: Scored): void {
    if (this.heap.length < this.k) {
      this.heap.push(item);
      this.bubbleUp(this.heap.length - 1);
    } else if (item.score > this.heap[0].score) {
      this.heap[0] = item;
      this.bubbleDown(0);
    }
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[i].score >= this.heap[p].score) break;
      [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
      i = p;
    }
  }

  private bubbleDown(i: number): void {
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let s = i;
      if (l < this.heap.length && this.heap[l].score < this.heap[s].score) s = l;
      if (r < this.heap.length && this.heap[r].score < this.heap[s].score) s = r;
      if (s === i) break;
      [this.heap[i], this.heap[s]] = [this.heap[s], this.heap[i]];
      i = s;
    }
  }

  sorted(): Scored[] {
    return [...this.heap].sort((a, b) => b.score - a.score);
  }

  get size(): number {
    return this.heap.length;
  }
}

export function mergeSorted(lists: Scored[][], k: number): Scored[] {
  const top = new TopK(k);
  const heads = lists.map((l) => [...l]);
  const all: Scored[] = [];
  const idx = new Array(lists.length).fill(0);

  for (;;) {
    let best = -1;
    for (let i = 0; i < heads.length; i++) {
      if (idx[i] < heads[i].length && (best === -1 || heads[i][idx[i]].score > heads[best][idx[best]].score)) {
        best = i;
      }
    }
    if (best === -1) break;
    all.push(heads[best][idx[best]++]);
    if (all.length >= k && heads.every((l, i) => idx[i] >= l.length || l[idx[i]].score <= all[all.length - 1].score)) break;
  }
  for (const s of all) top.push(s);
  return top.sorted();
}
