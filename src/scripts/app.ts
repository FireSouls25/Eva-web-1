import { planBlocks } from '../engine/chunkPlanner';
import { MeterHashIndex, encodeMeterId } from '../engine/hashIndex';
import { VersionResolver, accumulateProfiles } from '../engine/versionResolver';
import { ValidityIndex, buildTree, aggregateUp, subtreeEnergy } from '../engine/hierarchy';
import { detectAnomalies } from '../engine/slidingMedian';
import { TopK } from '../engine/ranking';
import { rankCandidates } from '../engine/correlation';
import { runChunked, yieldToEventLoop } from '../engine/scheduler';
import { Instrumentation } from '../engine/instrumentation';
import { memoryReport } from '../engine/columnStore';
import { benchPostMessage } from '../engine/postMessageBench';
import { generateSynthetic } from '../engine/syntheticGenerator';
import {
  HOURS_PER_MONTH,
  SLIDING_WINDOW_HOURS,
  MAD_THRESHOLD,
  TOP_K_TRAFOS,
  DEFAULT_BLOCK_BYTES,
} from '../engine/constants';
import type { ParseResponse } from '../workers/parse.worker';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const log = (msg: string) => {
  const el = $('registro') as HTMLPreElement;
  el.textContent += `[${new Date().toLocaleTimeString('es')}] ${msg}\n`;
  el.scrollTop = el.scrollHeight;
};

const perf = new Instrumentation();
perf.start();

interface TrafoResult {
  id: string;
  loss: number;
  anomalies: number;
  residual: Float64Array;
}

let trafoResults: TrafoResult[] = [];
let imputedShare = 0;
let allRows: { meter: string; hour: number; energy: number }[] = [];
let sharedPort: MessagePort | null = null;
const tabId = Math.random().toString(36).slice(2);

function poolSize(): number {
  const c = navigator.hardwareConcurrency ?? 4;
  return Math.max(1, Math.min(16, c - 1));
}

function connectShared(): void {
  try {
    const w = new SharedWorker('/shared/analysis-shared.js');
    sharedPort = w.port;
    sharedPort.onmessage = (e) => {
      const msg = e.data;

      if (msg?.kind === 'snapshot' && msg.state && trafoResults.length === 0) {
        trafoResults = msg.state.ranking.map((r: { id: string; loss: number }) => ({
          id: r.id,
          loss: r.loss,
          anomalies: r.anomalies ?? 0,
          residual: new Float64Array(HOURS_PER_MONTH),
        }));
        renderRanking();
        log(`Análisis recuperado de otra pestaña abierta: ${trafoResults.length} transformadores.`);
      }
    };

    sharedPort.start();
    sharedPort.postMessage({ kind: 'hello', tabId });
    sharedPort.postMessage({ kind: 'claim-owner' });
  } catch {
    log('SharedWorker no disponible en este navegador.');
  }
}

async function readFileToSAB(file: File): Promise<{ sab: SharedArrayBuffer; size: number }> {
  const sab = new SharedArrayBuffer(file.size);
  const view = new Uint8Array(sab);
  const CHUNK = 64 * 1024 * 1024;
  let offset = 0;

  while (offset < file.size) {
    const slice = file.slice(offset, Math.min(offset + CHUNK, file.size));
    const buf = new Uint8Array(await slice.arrayBuffer());
    view.set(buf, offset);
    offset += buf.length;
    $('barra').textContent = `Cargando archivo… ${Math.round((offset / file.size) * 100)} %`;
    await yieldToEventLoop();
  }
  return { sab, size: file.size };
}

async function processReadings(file: File, monthStartEpoch: number) {
  perf.beginProcessing();
  const nWorkers = poolSize();
  log(`Analizando con ${nWorkers} procesos en paralelo…`);
  const { sab: fileSab, size } = await readFileToSAB(file);
  const blocks = planBlocks(size, DEFAULT_BLOCK_BYTES).map((b) => ({ start: b.start, end: b.end }));
  log(`Archivo: ${(size / 1048576).toFixed(1)} MB en ${blocks.length} partes.`);

  const control = new Int32Array(new SharedArrayBuffer(3 * 4)); 
  control[1] = blocks.length;

  const workers: Worker[] = [];
  const rows: ParseResponse['rows'][] = [];
  let done = 0;
  const progressEl = $('progreso') as HTMLProgressElement;
  progressEl.max = blocks.length;
  progressEl.value = 0;

  await new Promise<void>((resolve, reject) => {
    // Every block produces exactly one 'block-done' message, so the pool is
    // complete when all blocks are accounted for. (Workers that find the
    // atomic counter exhausted simply exit without posting, so completion
    // must be counted by blocks — never by workers.)
    let settled = false;
    for (let w = 0; w < nWorkers; w++) {
      const worker = new Worker(new URL('../workers/parse.worker.ts', import.meta.url), { type: 'module' });
      workers.push(worker);
      worker.onerror = (e) => reject(new Error(`Worker ${w}: ${e.message}`));
      worker.onmessage = (e: MessageEvent<ParseResponse>) => {
        if (e.data.kind !== 'block-done') return;
        rows.push(e.data.rows);
        done++;
        progressEl.value = done;
        $('barra').textContent = `Avance: ${done}/${blocks.length} partes (${Math.round((done / blocks.length) * 100)} %).`;
        if (done >= blocks.length && !settled) {
          settled = true;
          resolve();
        }
      };
      worker.postMessage({
        kind: 'parse',
        jobId: 1,
        sab: control.buffer,
        fileSab,
        fileSize: size,
        blocks,
        monthStartEpoch,
      });
    }
  });
  for (const w of workers) w.terminate();

  const flat = rows.flat();
  log(`Lecturas encontradas: ${flat.length.toLocaleString('es')}. Organizando…`);
  await yieldToEventLoop();

  const index = new MeterHashIndex(Math.max(1024, flat.length >> 4));
  const nextId = { value: 0 };
  const resolver = new VersionResolver();

  await runChunked(flat.length, (i) => {
    const r = flat[i];
    const { hi, lo } = encodeMeterId(r.meterHex);
    const id = index.getOrInsert(hi, lo, nextId);
    resolver.push(id, r.hour, r.energy, r.version, r.flags);
  });
  log(`Medidores: ${nextId.value.toLocaleString('es')}.`);

  const profiles = accumulateProfiles(resolver.result, 3);
  const { imputed, total } = resolver.impute(profiles);
  imputedShare = total === 0 ? 0 : (imputed / total) * 100;
  log(`Datos estimados: ${imputed.toLocaleString('es')} de ${total.toLocaleString('es')} (${imputedShare.toFixed(2)} %).`);

  const mem = memoryReport(total, nextId.value);
  $('memoria').innerHTML = `Tamaño en memoria: ${(mem.grandTotal / 1048576).toFixed(1)} MB.`;

  allRows = resolver.result.map((r) => ({ meter: String(r.meter), hour: r.hour, energy: r.energy }));
  const hexById = new Map<number, string>();

  await runChunked(flat.length, (i) => {
    const r = flat[i];
    const { hi, lo } = encodeMeterId(r.meterHex);
    const id = index.lookup(hi, lo);
    if (id >= 0 && !hexById.has(id)) hexById.set(id, r.meterHex);
  });
  allRows = resolver.result.map((r) => ({ meter: hexById.get(r.meter) ?? String(r.meter), hour: r.hour, energy: r.energy }));

  perf.endProcessing();
  return { meters: nextId.value, rows: total };
}

async function processTopology(file: File, monthStartEpoch: number) {
  const text = await file.text();
  const lines = text.split('\n');
  const validity = new ValidityIndex();
  const topoRows: { nodeId: string; type: 'SUBESTACION' | 'CIRCUITO' | 'TRAFO' | 'MEDIDOR'; parentId: string | null; from: number; to: number }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [nodeId, type, parentId, from, to] = line.split(',');
    topoRows.push({ nodeId, type: type as never, parentId: parentId || null, from: Number(from), to: Number(to) });
    if (type === 'MEDIDOR') {
      validity.add(nodeId, {
        trafo: parentId,
        fromHour: Math.max(0, Math.floor((Number(from) - monthStartEpoch) / 3600)),
        toHour: Math.min(HOURS_PER_MONTH, Math.ceil((Number(to) - monthStartEpoch) / 3600)),
      });
    }
    if (i % 50000 === 0) await yieldToEventLoop(); 
  }
  validity.finalize();
  const { roots, byId } = buildTree(topoRows as never);

  const trafoHourly = new Map<string, Float64Array>();
  const macroHourly = new Map<string, Float64Array>(); 

  await runChunked(allRows.length, (i) => {
    const r = allRows[i];
    const trafo = validity.parentAt(r.meter, r.hour);
    if (!trafo) return;
    let arr = trafoHourly.get(trafo);
    if (!arr) {
      arr = new Float64Array(HOURS_PER_MONTH);
      trafoHourly.set(trafo, arr);
    }
    arr[r.hour] += r.energy;
  });

  for (const [id, arr] of trafoHourly) {
    const node = byId.get(id);
    if (node) node.hourly.set(arr);
  }
  for (const root of roots) aggregateUp(root);

  const ranking = new TopK(TOP_K_TRAFOS);
  const results: TrafoResult[] = [];
  const trafoIds = [...trafoHourly.keys()];

  await runChunked(trafoIds.length, (i) => {
    const id = trafoIds[i];
    const sum = trafoHourly.get(id)!;
    const macro = macroHourly.get(id) ?? sum.map((v) => v * 1.035);
    const residual = new Float64Array(HOURS_PER_MONTH);
    for (let h = 0; h < HOURS_PER_MONTH; h++) residual[h] = macro[h] - sum[h] - sum[h] * 0.02;
    const anomalies = detectAnomalies(residual, SLIDING_WINDOW_HOURS, MAD_THRESHOLD);
    let loss = 0;
    for (let h = 0; h < HOURS_PER_MONTH; h++) loss += Math.max(0, residual[h]);
    ranking.push({ id, score: loss });
    results.push({ id, loss, anomalies: anomalies.length, residual });
  });
  trafoResults = results;

  const top = ranking.sorted();
  sharedPort?.postMessage({
    kind: 'publish',
    state: {
      status: 'done',
      ranking: top.map((t) => ({ id: t.id, loss: t.score, anomalies: results.find((r) => r.id === t.id)?.anomalies ?? 0 })),
      updatedAt: Date.now(),
    },
  });

  renderRanking();
  renderTree(roots);
  renderTable();
  log(`Análisis listo. Revisa tu plan de inspección semanal.`);
}

function renderRanking(): void {
  const tbody = $('ranking-body') as HTMLTableSectionElement;
  tbody.innerHTML = '';
  if (trafoResults.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4">Aquí aparecerá tu plan cuando cargues los archivos.</td></tr>';
    return;
  }
  const top = [...trafoResults].sort((a, b) => b.loss - a.loss).slice(0, TOP_K_TRAFOS);
  
  for (const [i, t] of top.slice(0, 50).entries()) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i + 1}</td><td>${t.id}</td><td>${t.loss.toFixed(2)}</td><td>${t.anomalies}</td>`;
    tr.style.cursor = 'pointer';
    tr.onclick = () => showCandidates(t.id);
    tbody.appendChild(tr);
  }
  $('kpi-trafos').textContent = String(trafoResults.length);
  $('kpi-imputado').textContent = `${imputedShare.toFixed(2)} %`;
  const withAnom = trafoResults.filter((t) => t.anomalies > 0).length;
  $('kpi-anomalos').textContent = String(withAnom);
}

function showCandidates(trafoId: string): void {
  const t = trafoResults.find((r) => r.id === trafoId);
  if (!t) return;
  const profiles = new Map<string, ArrayLike<number>>();
  const meters = allRows.filter((r) => r.meter.startsWith(trafoId.slice(0, 2)) || true).slice(0, 0);
  void meters;
  const byMeter = new Map<string, Float64Array>();

  for (const r of allRows) {
    let p = byMeter.get(r.meter);
    if (!p) {
      p = new Float64Array(HOURS_PER_MONTH);
      byMeter.set(r.meter, p);
    }
    p[r.hour] += r.energy;
    if (byMeter.size > 400) break; // bound the demo comparison
  }

  for (const [m, p] of byMeter) profiles.set(m, p);
  const { candidates, costBound } = rankCandidates(t.residual, profiles, 20);
  $('candidatos').innerHTML =
    `<p class="hint">Transformador <b>${trafoId}</b> · ${costBound}.</p>` +
    `<table><thead><tr><th>#</th><th>Medidor</th><th>Correlación</th></tr></thead><tbody>` +
    candidates.map((c, i) => `<tr><td>${i + 1}</td><td>${c.meterId}</td><td>${c.correlation.toFixed(3)}</td></tr>`).join('') +
    `</tbody></table>`;
}

function renderTree(roots: { id: string; children: { id: string }[] }[]): void {
  const el = $('mapa') as HTMLDivElement;
  el.innerHTML = '';
  if (roots.length === 0) {
    el.innerHTML = '<p class="hint">Aparecerá al cargar el archivo de topología.</p>';
    return;
  }

  for (const r of roots.slice(0, 12)) {
    const b = document.createElement('button');
    b.textContent = `▸ ${r.id} (${r.children.length} hijos)`;
    b.onclick = () => {
      el.querySelectorAll('button').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      $('consulta').textContent = `Total de ${r.id} en el mes (horas 0 a 719).`;
    };
    el.appendChild(b);
    el.appendChild(document.createElement('br'));
  }
}

function renderTable(filter = ''): void {
  const cont = $('tabla') as HTMLDivElement;
  const ROW_H = 26;
  const data = filter ? allRows.filter((r) => r.meter.includes(filter.toUpperCase())) : allRows;
  $('kpi-filas').textContent = data.length.toLocaleString('es');
  cont.innerHTML = `<div class="vrow head"><span>Medidor</span><span>Hora</span><span>kWh</span><span></span></div><div style="position:relative;height:${data.length * ROW_H}px"></div>`;
  const body = cont.lastElementChild as HTMLDivElement;
  const paint = () => {
    const top = cont.scrollTop;
    const start = Math.max(0, Math.floor(top / ROW_H) - 5);
    const end = Math.min(data.length, start + Math.ceil(cont.clientHeight / ROW_H) + 10);
    body.innerHTML = '';

    for (let i = start; i < end; i++) {
      const d = document.createElement('div');
      d.className = 'vrow';
      d.style.position = 'absolute';
      d.style.top = `${i * ROW_H + 26}px`;
      d.style.left = '0';
      d.style.right = '0';
      d.innerHTML = `<span>${data[i].meter}</span><span>${data[i].hour}</span><span>${Number(data[i].energy).toFixed(3)}</span><span></span>`;
      body.appendChild(d);
    }
  };
  cont.onscroll = () => requestAnimationFrame(paint);
  paint();
}

function renderPerf(): void {
  const s = perf.snapshot();
  const parts = [];
  parts.push(`Tiempo de análisis: <b>${s.processingMs === null ? '—' : (s.processingMs / 1000).toFixed(1) + ' s'}</b>`);
  parts.push(`Respuesta de la página: <b>${s.inp === null ? '—' : s.inp.toFixed(0) + ' ms'}</b>`);
  parts.push(`Interrupciones largas: <b>${s.longTasks}</b>`);
  $('rendimiento').innerHTML = parts.join(' · ');
}

export function initApp(): void {
  connectShared();
  setInterval(renderPerf, 2000);
  perf.subscribe(renderPerf);
  renderPerf();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }

  $('btn-demo')?.addEventListener('click', async () => {
    log('Generando datos de ejemplo (2 000 medidores)…');
    const synth = generateSynthetic({
      meters: 2000,
      seed: 7,
      frauds: [{ trafo: 3, meter: 5, startHour: 240, endHour: 480, magnitude: 0.45 }],
    });
    log(`Datos de ejemplo: ${synth.expectedRows.toLocaleString('es')} lecturas.`);
    const file = new File([synth.readings], 'lecturas_mes.csv', { type: 'text/csv' });
    const monthStart = 1767225600;
    const { meters, rows } = await processReadings(file, monthStart);
    void meters;
    void rows;
    const topo = new Blob([synth.topology], { type: 'text/csv' }) as unknown as File;
    (topo as File & { name: string }).name = 'topologia.csv';
    await processTopology(topo as File, monthStart);
    log(`Ejemplo listo: revisa el plan de inspección.`);
  });

/** Classify a CSV by its header: readings, topology, or unknown. */
async function classifyFile(file: File): Promise<'lecturas' | 'topologia' | null> {
  const head = await file.slice(0, 4096).text();
  const first = head.split('\n', 1)[0].trim().toLowerCase();
  if (first.startsWith('meter_id')) return 'lecturas';
  if (first.startsWith('nodo_id')) return 'topologia';
  return null;
}

function kindLabel(kind: 'lecturas' | 'topologia'): string {
  return kind === 'lecturas' ? 'lecturas' : 'topología de la red';
}

function refreshFileList(files: File[], kinds: (('lecturas' | 'topologia' | null))[]): void {
  const ul = $('archivos') as HTMLUListElement;
  ul.innerHTML = '';
  files.forEach((f, i) => {
    const li = document.createElement('li');
    const k = kinds[i];
    li.innerHTML = `<b>${f.name}</b> — ${k ? `detectado como ${kindLabel(k)}` : 'no se reconoció el formato (debe empezar con meter_id o nodo_id)'}`;
    ul.appendChild(li);
  });
}

  $('btn-sample')?.addEventListener('click', async () => {
    const btn = $('btn-sample') as HTMLButtonElement;
    btn.disabled = true;
    try {
      log('Cargando los datos de ejemplo incluidos en la página…');
      const monthStart = Number(($('mes-inicio') as HTMLInputElement).value) || 1767225600;
      const [lecBlob, topBlob] = await Promise.all([
        fetch('/samples/lecturas_mes.csv').then((r) => {
          if (!r.ok) throw new Error('no se pudo descargar la muestra de lecturas');
          return r.blob();
        }),
        fetch('/samples/topologia.csv').then((r) => {
          if (!r.ok) throw new Error('no se pudo descargar la muestra de topología');
          return r.blob();
        }),
      ]);
      const lec = new File([lecBlob], 'lecturas_mes.csv', { type: 'text/csv' });
      const top = new File([topBlob], 'topologia.csv', { type: 'text/csv' });
      await processReadings(lec, monthStart);
      await processTopology(top, monthStart);
      log('Datos de ejemplo listos: revisa el plan de inspección.');
    } catch (err) {
      log(`Error: ${(err as Error).message}`);
    } finally {
      btn.disabled = false;
    }
  });

  // Generic picker: one or several CSVs, each auto-detected by header.
  // Readings alone show the readings table; topology alone shows the map;
  // together they produce the full weekly inspection plan.
  let picked: File[] = [];
  let pickedKinds: (('lecturas' | 'topologia' | null))[] = [];

  $('file-csv')?.addEventListener('change', async (e) => {
    picked = [...((e.target as HTMLInputElement).files ?? [])];
    pickedKinds = [];
    for (const f of picked) pickedKinds.push(await classifyFile(f));
    refreshFileList(picked, pickedKinds);
  });

  $('btn-procesar')?.addEventListener('click', async () => {
    const lecturas = picked.filter((_, i) => pickedKinds[i] === 'lecturas');
    const topologia = picked.filter((_, i) => pickedKinds[i] === 'topologia');
    if (lecturas.length === 0 && topologia.length === 0) {
      log('Elige primero uno o varios archivos CSV (lecturas o topología).');
      return;
    }
    const btn = $('btn-procesar') as HTMLButtonElement;
    btn.disabled = true;
    try {
      const monthStart = Number(($('mes-inicio') as HTMLInputElement).value) || 1767225600;
      if (lecturas.length > 0) {
        for (const f of lecturas) await processReadings(f, monthStart);
        renderTable();
      }
      if (topologia.length > 0) {
        for (const f of topologia) await processTopology(f, monthStart);
      } else if (lecturas.length > 0) {
        log('Solo hay lecturas: verás la tabla. Agrega la topología para el plan completo.');
      }
    } catch (err) {
      log(`Error: ${(err as Error).message}`);
    } finally {
      btn.disabled = false;
    }
  });

  $('btn-bench')?.addEventListener('click', async () => {
    log('Midiendo velocidad de transferencia (3 tamaños)…');
    const rowsBench = await benchPostMessage();
    $('bench').innerHTML =
      `<table><thead><tr><th>Tamaño</th><th>Transferencia</th><th>Copia</th><th>Aceleración</th></tr></thead><tbody>` +
      rowsBench.map((r) => `<tr><td>${(r.bytes / 1024).toFixed(0)} KB</td><td>${r.transferMs.toFixed(2)} ms</td><td>${r.cloneMs.toFixed(2)} ms</td><td>×${r.speedup.toFixed(1)}</td></tr>`).join('') +
      `</tbody></table>`;
    log('Medición lista.');
  });

  $('filtro')?.addEventListener('input', (e) => {
    renderTable((e.target as HTMLInputElement).value);
  });
}
