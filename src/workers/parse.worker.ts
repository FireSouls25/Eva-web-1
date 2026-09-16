// Dedicated parse Worker (RF-1, RT-1, RT-2).
//
// The orchestrator assigns byte blocks dynamically: workers pull the next
// block index from a shared atomic counter, so a slow/expensive block never
// stalls the pool (dynamic scheduling beats a fixed static split). Each
// worker receives ONLY its byte range plus shared views — it never returns
// a full copy of the data (RT-2). Line-boundary rules from chunkPlanner are
// re-applied here on the decoded slice.

export interface ParseRequest {
  kind: 'parse';
  jobId: number;
  sab: SharedArrayBuffer; // control block: Int32Array [nextBlock, totalBlocks, doneCount]
  fileSab: SharedArrayBuffer; // whole-file bytes (transferred once, shared)
  fileSize: number;
  blocks: { start: number; end: number }[];
  monthStartEpoch: number;
}

export interface ParseRow {
  meterHex: string;
  hour: number;
  energy: number; // NaN when missing
  version: number;
  flags: number;
}

export interface ParseResponse {
  kind: 'block-done';
  jobId: number;
  blockIndex: number;
  rows: ParseRow[];
  rowCount: number;
}

function findLineEnd(text: string, from: number): number {
  const i = text.indexOf('\n', from);
  return i === -1 ? text.length : i + 1;
}

self.onmessage = (ev: MessageEvent<ParseRequest>) => {
  const msg = ev.data;
  if (msg.kind !== 'parse') return;
  const control = new Int32Array(msg.sab);
  const bytes = new Uint8Array(msg.fileSab);
  const decoder = new TextDecoder();
  for (;;) {
    const blockIndex = Atomics.add(control, 0, 1);
    if (blockIndex >= msg.blocks.length) break;
    const plan = msg.blocks[blockIndex];
    // Byte-accurate slicing (chained boundaries): the start always moves
    // forward to just past the next newline (== previous block's extended
    // end), and the end extends forward the same way. No lost rows, none
    // duplicated — see chunkPlanner.alignStartToNewline.
    let start = plan.start;
    let end = plan.end;
    if (start !== 0) {
      while (start < msg.fileSize && bytes[start] !== 0x0a) start++;
      start = start < msg.fileSize ? start + 1 : msg.fileSize;
    }
    while (end < msg.fileSize && bytes[end] !== 0x0a) end++;
    if (end < msg.fileSize) end++;
    const slice = bytes.subarray(start, end);
    const text = decoder.decode(slice);
    void findLineEnd;
    const rows: ParseRow[] = [];
    let pos = 0;
    // Skip CSV header only in the very first block.
    if (blockIndex === 0) {
      const nl = text.indexOf('\n');
      pos = nl === -1 ? text.length : nl + 1;
    }
    while (pos < text.length) {
      let nl = text.indexOf('\n', pos);
      if (nl === -1) nl = text.length;
      const line = text.slice(pos, nl);
      pos = nl + 1;
      if (!line) continue;
      const c1 = line.indexOf(',');
      const c2 = line.indexOf(',', c1 + 1);
      const c3 = line.indexOf(',', c2 + 1);
      const c4 = line.indexOf(',', c3 + 1);
      if (c1 === -1 || c2 === -1 || c3 === -1 || c4 === -1) continue;
      const meterHex = line.slice(0, c1);
      const ts = Number(line.slice(c1 + 1, c2));
      const kwhRaw = line.slice(c2 + 1, c3);
      const version = Number(line.slice(c3 + 1, c4));
      const flags = Number(line.slice(c4 + 1));
      const hour = Math.floor((ts - msg.monthStartEpoch) / 3600);
      if (hour < 0 || hour >= 720) continue;
      rows.push({
        meterHex,
        hour,
        energy: kwhRaw === '' ? NaN : Number(kwhRaw),
        version: Number.isFinite(version) ? version : 1,
        flags: Number.isFinite(flags) ? flags : 0,
      });
    }
    Atomics.add(control, 2, 1);
    (self as unknown as { postMessage: (m: ParseResponse) => void }).postMessage({
      kind: 'block-done',
      jobId: msg.jobId,
      blockIndex,
      rows,
      rowCount: rows.length,
    });
  }
};
