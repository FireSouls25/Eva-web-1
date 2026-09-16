import { FLAG_GAP } from './constants';

export interface ResolvedReading {
  meter: number;
  hour: number;
  energy: number;
  version: number;
  imputed: boolean;
}

export class VersionResolver {
  private winners = new Map<number, number>();
  private rows: ResolvedReading[] = [];

  push(meter: number, hour: number, energy: number, version: number, flags: number): void {
    const key = meter * 1024 + hour;
    const missing = Number.isNaN(energy) || (flags & FLAG_GAP) !== 0;
    const at = this.winners.get(key);

    if (at === undefined) {
      this.winners.set(key, this.rows.length);
      this.rows.push({ meter, hour, energy, version, imputed: missing });
      return;
    }
    const cur = this.rows[at];
    if (version > cur.version) {
      cur.energy = energy;
      cur.version = version;
      cur.imputed = missing;
    }
  }

  impute(hourOfDayMeans: Map<number, Float64Array>): { imputed: number; total: number } {
    let imputed = 0;

    for (const r of this.rows) {
      if (!Number.isNaN(r.energy)) continue;
      const means = hourOfDayMeans.get(r.meter);
      const fallback = means ? means[r.hour % 24] : NaN;
      r.energy = Number.isNaN(fallback) ? 0 : fallback;
      r.imputed = true;
      imputed++;
    }
    return { imputed, total: this.rows.length };
  }

  get result(): ResolvedReading[] {
    return this.rows;
  }
}

export function accumulateProfiles(
  rows: Iterable<{ meter: number; hour: number; energy: number }>,
  dayOfWeekOfHour0: number,
): Map<number, Float64Array> {
  const sums = new Map<number, Float64Array>();
  const counts = new Map<number, Float64Array>();

  for (const r of rows) {
    if (Number.isNaN(r.energy)) continue;
    const day = Math.floor(r.hour / 24);
    const dow = (dayOfWeekOfHour0 + day) % 7;

    if (dow >= 5) continue; // business days only
    let s = sums.get(r.meter);
    let c = counts.get(r.meter);
    if (!s || !c) {
      s = new Float64Array(24);
      c = new Float64Array(24);
      sums.set(r.meter, s);
      counts.set(r.meter, c);
    }
    s[r.hour % 24] += r.energy;
    c[r.hour % 24] += 1;
  }
  
  const means = new Map<number, Float64Array>();
  for (const [m, s] of sums) {
    const c = counts.get(m)!;
    const mean = new Float64Array(24);
    for (let h = 0; h < 24; h++) mean[h] = c[h] > 0 ? s[h] / c[h] : NaN;
    means.set(m, mean);
  }
  return means;
}
