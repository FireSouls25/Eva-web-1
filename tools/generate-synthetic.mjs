// Node CLI: generate synthetic lecturas + topologia CSVs (deliverable).
// Usage: npm run generate -- --meters 2000 --out ./samples
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSynthetic } from '../src/engine/syntheticGenerator.ts';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] ?? '']);
    return acc;
  }, []),
);

const meters = Number(args.meters ?? 2000);
const out = args.out ?? './samples';
mkdirSync(out, { recursive: true });

const result = generateSynthetic({
  meters,
  seed: 7,
  frauds: [
    { trafo: 3, meter: 5, startHour: 24 * 10, endHour: 24 * 20, magnitude: 0.45 },
    { trafo: 11, meter: 40, startHour: 24 * 5, endHour: 24 * 25, magnitude: 0.6 },
  ],
});

writeFileSync(join(out, 'lecturas_mes.csv'), result.readings);
writeFileSync(join(out, 'topologia.csv'), result.topology);
console.log(`medidores=${meters} filas=${result.expectedRows} -> ${out}/`);
