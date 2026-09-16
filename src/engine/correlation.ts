export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
  }
  const denom = Math.sqrt((n * saa - sa * sa) * (n * sbb - sb * sb));
  if (denom === 0) return 0;
  return (n * sab - sa * sb) / denom;
}

export interface Candidate {
  meterId: string;
  correlation: number;
}

export function rankCandidates(
  residual: ArrayLike<number>,
  profiles: Map<string, ArrayLike<number>>,
  limit = 20,
): { candidates: Candidate[]; costBound: string } {
  const out: Candidate[] = [];
  const hours = residual.length;
  for (const [meterId, profile] of profiles) {
    out.push({ meterId, correlation: pearson(profile, residual) });
  }
  
  out.sort((a, b) => b.correlation - a.correlation);
  const m = profiles.size;
  return {
    candidates: out.slice(0, limit),
    costBound: `Comparación de ${m} medidores × ${hours} horas`,
  };
}
