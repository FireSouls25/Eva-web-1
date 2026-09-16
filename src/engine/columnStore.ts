export const COLUMN_BYTES_PER_RECORD = 4 + 2 + 2 + 1 + 3 + 8; // 20

export interface ColumnStore {
  buffer: SharedArrayBuffer;
  meterIdx: Uint32Array;
  hourSlot: Uint16Array;
  version: Uint16Array;
  flags: Uint8Array;
  energy: Float64Array;
  length: number;
}

export function createColumnStore(capacity: number): ColumnStore {
  const n = capacity;
  const buffer = new SharedArrayBuffer(
    n * 4 + n * 2 + n * 2 + n * 1 + n * 3 + n * 8,
  );
  let off = 0;
  const meterIdx = new Uint32Array(buffer, off, n); off += n * 4;
  const hourSlot = new Uint16Array(buffer, off, n); off += n * 2;
  const version = new Uint16Array(buffer, off, n); off += n * 2;
  const flags = new Uint8Array(buffer, off, n); off += n * 1;
  off += n * 3; 
  const energy = new Float64Array(buffer, off, n);
  return { buffer, meterIdx, hourSlot, version, flags, energy, length: 0 };
}

export function memoryReport(numRecords: number, numMeters: number) {
  const columnar = numRecords * COLUMN_BYTES_PER_RECORD;
  const hashBytes = numMeters * (4 + 4 + 4); 
  const jsObjects = numRecords * 160; 
  return {
    bytesPerRecord: COLUMN_BYTES_PER_RECORD,
    columnarTotal: columnar,
    hashTotal: hashBytes,
    grandTotal: columnar + hashBytes,
    jsObjectsTotal: jsObjects,
    savingsFactor: jsObjects / Math.max(1, columnar + hashBytes),
  };
}
