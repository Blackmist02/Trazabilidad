// Copia a public/ocr los archivos del OCR (tesseract.js) para servirlos desde la propia app:
// el reconocimiento de texto se hace en el dispositivo, sin CDN ni servicios externos.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = new URL('../public/ocr/', import.meta.url);
mkdirSync(out, { recursive: true });

const tesseractDist = join(dirname(require.resolve('tesseract.js/package.json')), 'dist');
const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const spaDir = join(dirname(require.resolve('@tesseract.js-data/spa/package.json')), '4.0.0_best_int');

const files = [
  [join(tesseractDist, 'worker.min.js'), 'worker.min.js'],
  // Solo motor LSTM: el worker elige la variante según el soporte SIMD del navegador.
  [join(coreDir, 'tesseract-core-relaxedsimd-lstm.wasm.js'), 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  [join(coreDir, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(coreDir, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(spaDir, 'spa.traineddata.gz'), 'spa.traineddata.gz'],
];
for (const [from, name] of files) copyFileSync(from, new URL(name, out));
console.log(`OCR: ${files.length} archivos copiados a public/ocr`);
