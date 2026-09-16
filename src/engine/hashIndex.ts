import { HASH_MAX_LOAD } from './constants';

export function encodeMeterId(hex: string): { hi: number; lo: number } {
  const hi = parseInt(hex.slice(0, 8), 16) >>> 0;
  const lo = parseInt(hex.slice(8, 12), 16) >>> 0;
  return { hi, lo };
}

export function decodeMeterId(hi: number, lo: number): string {
  return hi.toString(16).padStart(8, '0').toUpperCase() + lo.toString(16).padStart(4, '0').toUpperCase();
}

function fnv1a(hi: number, lo: number): number {
  let h = 0x811c9dc5;
  h ^= hi & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (hi >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (hi >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (hi >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  h ^= lo & 0xff; h = Math.imul(h, 0x01000193);
  h ^= (lo >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
  return h >>> 0;
}

export class MeterHashIndex {
  capacity: number;
  mask: number;
  keysHi: Uint32Array;
  keysLo: Uint32Array;
  values: Int32Array; // -1 = empty slot
  occupied: number;

  constructor(expectedMeters: number, buffers?: { hi: Uint32Array; lo: Uint32Array; values: Int32Array }) {
    let cap = 1;
    while (cap < expectedMeters / HASH_MAX_LOAD) cap *= 2;
    this.capacity = cap;
    this.mask = cap - 1;
    if (buffers) {
      this.keysHi = buffers.hi;
      this.keysLo = buffers.lo;
      this.values = buffers.values;
    } else {
      this.keysHi = new Uint32Array(cap);
      this.keysLo = new Uint32Array(cap);
      this.values = new Int32Array(cap).fill(-1);
    }
    this.occupied = 0;
  }

  getOrInsert(hi: number, lo: number, nextId: { value: number }): number {
    let slot = fnv1a(hi, lo) & this.mask;
    for (;;) {
      const v = this.values[slot];
      if (v === -1) {
        const id = nextId.value++;
        this.keysHi[slot] = hi;
        this.keysLo[slot] = lo;
        this.values[slot] = id;
        this.occupied++;
        return id;
      }
      if (this.keysHi[slot] === hi && this.keysLo[slot] === lo) return v;
      slot = (slot + 1) & this.mask; // linear probing
    }
  }

  lookup(hi: number, lo: number): number {
    let slot = fnv1a(hi, lo) & this.mask;
    for (;;) {
      const v = this.values[slot];
      if (v === -1) return -1;
      if (this.keysHi[slot] === hi && this.keysLo[slot] === lo) return v;
      slot = (slot + 1) & this.mask;
    }
  }

  loadFactor(): number {
    return this.occupied / this.capacity;
  }
}
