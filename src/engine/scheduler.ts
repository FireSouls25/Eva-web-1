export const MAIN_THREAD_BUDGET_MS = 50;

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function runChunked(
  total: number,
  step: (i: number) => void,
  budgetMs = MAIN_THREAD_BUDGET_MS,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let sliceStart = performance.now();
  
  for (let i = 0; i < total; i++) {
    step(i);
    if (performance.now() - sliceStart >= budgetMs) {
      onProgress?.(i + 1, total);
      await yieldToEventLoop();
      sliceStart = performance.now();
    }
  }
  onProgress?.(total, total);
}
