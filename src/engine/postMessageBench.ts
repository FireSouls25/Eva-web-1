export interface BenchRow {
  bytes: number;
  transferMs: number;
  cloneMs: number;
  speedup: number;
}

async function roundTrip(worker: Worker, buffer: ArrayBuffer, transfer: boolean): Promise<number> {
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const onMsg = () => {
      worker.removeEventListener('message', onMsg);
      resolve();
    };
    worker.addEventListener('message', onMsg);
    if (transfer) worker.postMessage({ probe: buffer }, [buffer]);
    else worker.postMessage({ probe: buffer });
  });
  return performance.now() - t0;
}

export async function benchPostMessage(sizes: number[] = [65536, 1048576, 8388608]): Promise<BenchRow[]> {
  const worker = new Worker(
    URL.createObjectURL(
      new Blob(['self.onmessage = (e) => self.postMessage({ ok: true });'], { type: 'text/javascript' }),
    ),
  );
  
  const rows: BenchRow[] = [];
  try {
    for (const bytes of sizes) {
      const a = new ArrayBuffer(bytes);
      const b = new ArrayBuffer(bytes);
     
      await roundTrip(worker, new ArrayBuffer(1024), true);
      const t: number[] = [];
      const c: number[] = [];

      for (let i = 0; i < 5; i++) {
        t.push(await roundTrip(worker, a.slice(0), true));
        c.push(await roundTrip(worker, b.slice(0), false));
      }

      t.sort((x, y) => x - y);
      c.sort((x, y) => x - y);
      rows.push({ bytes, transferMs: t[2], cloneMs: c[2], speedup: c[2] / Math.max(0.001, t[2]) });
    }
  } finally {
    worker.terminate();
  }
  return rows;
}
