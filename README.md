# Auditoría de pérdidas de energía en el navegador

Aplicación web (Astro) que concilia ~20 millones de lecturas horarias contra la
topología eléctrica y produce el plan semanal de inspección — todo dentro del
navegador, sin instalar software y sin subir datos a ningún servidor.

> UI en español · código en inglés · Node ≥ 22 (este repo se desarrolló con Node 24).

## Requisitos

- El Node 24 de `Downloads\node-v24.21.0-win-x64\node-v24.21.0-win-x64` (no el del sistema):

```powershell
& "C:\Users\labinf6.pasto\Downloads\node-v24.21.0-win-x64\node-v24.21.0-win-x64\npm.cmd" install
& "C:\Users\labinf6.pasto\Downloads\node-v24.21.0-win-x64\node-v24.21.0-win-x64\npm.cmd" run dev
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor local con COOP/COEP (crossOriginIsolated = true) |
| `npm run build` / `preview` | Compilación y vista previa de producción |
| `npm run generate -- --meters 2000 --out ./samples` | Datos sintéticos con fraudes sembrados |
| `npm run verify-chunks` | Prueba de conteo exacto de filas por bloque (RF-1) |

## Flujo del dato

Archivo local → bloques con corte exacto en `\n` → pool de Workers con reparto
dinámico (contador atómico) → índice hash FNV-1a con ids densos + columnas en
SharedArrayBuffer → resolución de versiones → imputación por perfil horario →
agregación jerárquica con vigencias (búsqueda binaria) → residual menos pérdida
técnica → mediana/MAD deslizante 168 h (dos montículos) → montículo top-200 →
Pearson contra el residual para candidatos.

## Despliegue (URL pública, RT-4/RT-10)

Cualquier hosting estático sirve (`dist/`). Las cabeceras
`Cross-Origin-Opener-Policy: same-origin` y
`Cross-Origin-Embedder-Policy: require-corp` ya están declaradas en
`vercel.json`, `netlify.toml` y `public/_headers`; verifica en consola que
`crossOriginIsolated === true`.

## Estructura

- `src/pages/` — interfaz en español (`index.astro`, `informe.astro`)
- `src/engine/` — algoritmo (índice, columnas, jerarquía, mediana, ranking…)
- `src/workers/parse.worker.ts` — parseo paralelo por bloques
- `public/shared/analysis-shared.js` — estado compartido entre pestañas
- `public/sw.js` — app shell sin conexión
- `tools/` — generador sintético y verificación de bloques
