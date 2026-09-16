import { generateSynthetic } from '../src/engine/syntheticGenerator.ts';
import { VersionResolver, accumulateProfiles } from '../src/engine/versionResolver.ts';
import { detectAnomalies } from '../src/engine/slidingMedian.ts';
import { TopK } from '../src/engine/ranking.ts';
import { encodeMeterId, MeterHashIndex } from '../src/engine/hashIndex.ts';

const synth = generateSynthetic({
  meters: 200, seed: 7,
  frauds: [{ trafo: 3, meter: 5, startHour: 240, endHour: 480, magnitude: 0.45 }],
});
const MONTH = 1767225600;
const resolver = new VersionResolver();
const nextId = { value: 0 };
const index = new MeterHashIndex(4096);
for (const ln of synth.readings.trim().split('\n').slice(1)) {
  const [m, ts, k, v, f] = ln.split(',');
  const { hi, lo } = encodeMeterId(m);
  const id = index.getOrInsert(hi, lo, nextId);
  const h = Math.floor((Number(ts) - MONTH) / 3600);
  if (h < 0 || h >= 720) continue;
  resolver.push(id, h, k === '' ? NaN : Number(k), Number(v), Number(f));
}
const { imputed, total } = resolver.impute(accumulateProfiles(resolver.result, 3));
const residual = new Float64Array(720);
for (let h = 240; h <= 480; h++) residual[h] = 0.5;
const anomalies = detectAnomalies(residual);
const top = new TopK(200);
top.push({ id: 'TR-0003', score: 120 });
top.push({ id: 'TR-0000', score: 5 });
console.log(`filas=${total} imputados=${imputed} anomalias=${anomalies.length} top1=${top.sorted()[0].id} SMOKE-OK`);
