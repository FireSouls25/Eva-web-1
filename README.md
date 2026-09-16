# Auditoría de pérdidas de energía en el navegador

Aplicación web Astro que concilia lecturas horarias contra la
topología eléctrica y produce el plan semanal de inspección — todo dentro del
navegador, sin instalar software y sin subir datos a ningún servidor.

## Requisitos

Node.js 22 o mayor

## Scripts

| Comando | Qué hace |
|---|---|
| `npm install` | Instalar dependencias |
| `npm run dev` | Servidor local con COOP/COEP |
| `npm run build` / `preview` | Compilación y vista previa de producción |
| `npm run generate -- --meters 2000 --out ./samples` | Datos sintéticos con fraudes sembrados |
| `npm run verify-chunks` | Prueba de conteo exacto de filas por bloque |

## Muestra incluida en el sitio

`public/samples/` contiene `lecturas_mes.csv` (200 medidores, ~145 000 filas,
4,7 MB) y `topologia.csv` con un fraude sembrado conocido. Se despliegan con
el sitio y la página ofrece el botón **«Usar muestra incluida»** más enlaces
de descarga, para probar sin tener los archivos reales.

## Flujo del dato

Archivo local → bloques con corte exacto en `\n` → pool de Workers con reparto
dinámico (contador atómico) → índice hash FNV-1a con ids densos + columnas en
SharedArrayBuffer → resolución de versiones → imputación por perfil horario →
agregación jerárquica con vigencias (búsqueda binaria) → residual menos pérdida
técnica → mediana/MAD deslizante 168 h (dos montículos) → montículo top-200 →
Pearson contra el residual para candidatos.

## Estructura

- `src/pages/` — interfaz
- `src/engine/` — algoritmo
- `src/workers/parse.worker.ts` — parseo paralelo por bloques
- `public/shared/analysis-shared.js` — estado compartido entre pestañas
- `public/sw.js` — app shell sin conexión
- `tools/` — generador sintético y verificación de bloques