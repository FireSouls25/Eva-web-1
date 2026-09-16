export interface BlockPlan {
  index: number;
  start: number; // inclusive byte offset (already line-aligned for start>0)
  end: number; // exclusive byte offset, extended to a line break
}

export function planBlocks(fileSize: number, blockBytes: number): BlockPlan[] {
  const plans: BlockPlan[] = [];
  let start = 0;
  let index = 0;
  
  while (start < fileSize) {
    const end = Math.min(start + blockBytes, fileSize);
    plans.push({ index: index++, start, end });
    start = end;
  }
  return plans;
}

export function extendEndToNewline(bytes: Uint8Array, end: number): number {
  let e = end;
  while (e < bytes.length && bytes[e] !== 0x0a) e++;
  return e < bytes.length ? e + 1 : bytes.length;
}

export function alignStartToNewline(bytes: Uint8Array, start: number): number {
  if (start === 0) return 0;
  return extendEndToNewline(bytes, start);
}

export function countNewlines(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) n++;
  return n;
}
