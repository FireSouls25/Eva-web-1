// Node check: prove block-boundary accounting (RF-1 demo).
// Splits a synthetic file into odd-sized blocks and verifies the sum of
// per-block line counts equals the known total — no lost/duplicated rows.
import { generateSynthetic } from '../src/engine/syntheticGenerator.ts';

const text = generateSynthetic({ meters: 50, days: 2, seed: 1 }).readings;
const bytes = new TextEncoder().encode(text);
const expected = bytes.filter((b) => b === 0x0a).length - 1; // minus header

for (const blockSize of [37, 1000, 65536]) {
  // raw cut points, like planBlocks()
  const cuts = [];
  for (let s = 0; s < bytes.length; s += blockSize) {
    cuts.push([s, Math.min(s + blockSize, bytes.length)]);
  }
  let total = 0;
  cuts.forEach(([rawStart, rawEnd], i) => {
    // Chained boundaries: start always extends forward (== previous end).
    let s = rawStart;
    if (s !== 0) {
      while (s < bytes.length && bytes[s] !== 0x0a) s++;
      s = Math.min(s + 1, bytes.length);
    }
    let e = rawEnd;
    while (e < bytes.length && bytes[e] !== 0x0a) e++;
    e = Math.min(e + 1, bytes.length);
    let n = 0;
    for (let k = s; k < e; k++) if (bytes[k] === 0x0a) n++;
    if (i === 0) n -= 1; // header line lives in block 0
    total += n;
  });
  const ok = total === expected;
  console.log(`bloque=${blockSize} esperado=${expected} contado=${total} ${ok ? 'OK' : 'FALLA'}`);
  if (!ok) process.exitCode = 1;
}
