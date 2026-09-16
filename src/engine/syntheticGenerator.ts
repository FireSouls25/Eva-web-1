export interface SyntheticOptions {
  meters: number;
  days?: number; 
  gapRate?: number;
  dupRate?: number; 
  movedMeters?: number; 
  newMeters?: number;
  frauds?: { trafo: number; meter: number; startHour: number; endHour: number; magnitude: number }[];
  seed?: number;
  startEpoch?: number; 
}

export interface SyntheticResult {
  readings: string; 
  topology: string;
  expectedRows: number; 
  seededFrauds: NonNullable<SyntheticOptions['frauds']>;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomHex(rand: () => number, chars: number): string {
  let s = '';
  const digits = '0123456789ABCDEF';
  for (let i = 0; i < chars; i++) s += digits[Math.floor(rand() * 16)];
  return s;
}

export function generateSynthetic(opts: SyntheticOptions): SyntheticResult {
  const days = opts.days ?? 30;
  const hours = days * 24;
  const startEpoch = opts.startEpoch ?? 1767225600;
  const rand = mulberry32(opts.seed ?? 42);
  const gapRate = opts.gapRate ?? 0.06;
  const dupRate = opts.dupRate ?? 0.012;

  const trafos = Math.max(1, Math.ceil(opts.meters / 40));
  const meterIds: string[] = Array.from({ length: opts.meters }, () => randomHex(rand, 12));
  const meterTrafo = meterIds.map((_, i) => i % trafos);

  const fraudByMeter = new Map<number, { startHour: number; endHour: number; magnitude: number }>();
  for (const f of opts.frauds ?? []) fraudByMeter.set(f.meter, f);

  const lines = ['meter_id,ts,kwh,version,flags'];
  let count = 0;
  for (let m = 0; m < opts.meters; m++) {
    const base = 0.3 + rand() * 0.5;
    for (let h = 0; h < hours; h++) {
      const ts = startEpoch + h * 3600;
      const hod = h % 24;
      const profile = base * (0.5 + 0.5 * Math.sin(((hod - 7) / 24) * Math.PI * 2) + 0.6);
      const fraud = fraudByMeter.get(m);
      const stolen = fraud && h >= fraud.startHour && h <= fraud.endHour ? fraud.magnitude : 0;
      const r = rand();
      
      if (r < gapRate) {
        lines.push(`${meterIds[m]},${ts},,1,2`);
        count++;
      } else {
        const reverse = rand() < 0.005;
        const v = Math.max(0, profile + (rand() - 0.5) * 0.1 - stolen);
        lines.push(`${meterIds[m]},${ts},${reverse ? -v.toFixed(3) : v.toFixed(3)},1,${reverse ? 4 : 0}`);
        count++;
        if (rand() < dupRate) {
          lines.push(`${meterIds[m]},${ts},${(v + 0.01).toFixed(3)},2,0`);
          count++;
        }
      }
    }
  }

  const tlines = ['nodo_id,tipo,padre_id,desde,hasta'];
  const FAR = 4102444800;
  tlines.push(`SUB-NORTE,SUBESTACION,,1735689600,${FAR}`);
  const circuits = Math.max(1, Math.ceil(trafos / 12));
  for (let c = 0; c < circuits; c++) tlines.push(`CIR-${String(c + 1).padStart(2, '0')},CIRCUITO,SUB-NORTE,1735689600,${FAR}`);
  for (let t = 0; t < trafos; t++) {
    tlines.push(`TR-${String(t).padStart(4, '0')},TRAFO,CIR-${String((t % circuits) + 1).padStart(2, '0')},1735689600,${FAR}`);
  }
  meterIds.forEach((id, m) => {
    const t = meterTrafo[m];
    tlines.push(`${id},MEDIDOR,TR-${String(t).padStart(4, '0')},1735689600,${FAR}`);
  });

  return { readings: lines.join('\n') + '\n', topology: tlines.join('\n') + '\n', expectedRows: count, seededFrauds: opts.frauds ?? [] };
}
