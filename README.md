# Trazabilidad · Escáner de acreditaciones y métricas de stand

Aplicación web móvil (PWA) para registrar el paso de los asistentes por un stand escaneando el QR de su credencial. Se usa desde el navegador del celular, sin instalar nada.

**Producción:** https://blackmist02.github.io/Trazabilidad/

## Funcionalidades

| Sección | Qué hace |
|---|---|
| **Escanear** | Cámara trasera (con selector si hay varias), estado de permisos y errores, iniciar/detener, entrada manual del código, registro sin código, vibración/sonido y destello al leer. Una misma lectura no se procesa dos veces (filtro por fotogramas + enfriamiento configurable). |
| **Confirmación** | Nombre, institución y cargo (leídos de la credencial impresa o de una visita anterior del mismo código; el nombre también del QR si lo trae), identificador, fecha/hora automática no editable, observaciones opcionales, aviso de visitas previas. Sin nombre queda «pendiente de completar». |
| **Historial** | Lista cronológica, búsqueda por nombre/código, filtro por fecha, solo pendientes, detalle, corrección de nombre con historial de cambios, totales del día, exportación CSV de lo filtrado. |
| **Métricas** | Visitas, códigos únicos (estimación de visitantes), repetidas, con nombre, sin nombre, sin identificador, por hora, por día, última visita y evolución acumulada. |
| **Ajustes** | Evento, stand, zona horaria, política de duplicados, modo de almacenamiento (local / sincronizado), conexión e inicio de sesión de Supabase, exportación completa, aviso de privacidad, borrado de datos locales. |

## Arquitectura

```
React 19 + TypeScript + Vite 8 (SPA estática, navegación por hash → sin 404 en GitHub Pages)
├─ src/lib/            Lógica pura y probada
│  ├─ qr.ts            Interpretación del QR (identificador, URL, vCard, MECARD, JSON, texto)
│  ├─ scanGate.ts      Filtro de lecturas repetidas de la cámara
│  ├─ visits.ts        Modelo de registro, correcciones con historial, visitas previas
│  ├─ metrics.ts       Cálculo de métricas
│  ├─ csv.ts           Exportación CSV (UTF-8 con BOM, anti-inyección de fórmulas)
│  ├─ camera.ts        Diagnóstico de errores de cámara
│  ├─ time.ts          Fechas en America/Santiago (almacenamiento en UTC)
│  └─ settings.ts      Configuración y validación de claves de Supabase
├─ src/data/
│  ├─ db.ts            IndexedDB (idb): almacén local persistente
│  ├─ remote.ts        Acceso a Supabase y clasificación de errores
│  └─ sync.ts          Sincronización: envío idempotente, correcciones, descarga incremental
├─ src/state/store.tsx Estado global, reintentos con espera exponencial, sesión
├─ src/components/     Pantallas (Escanear, Confirmar, Historial, Detalle, Métricas, Ajustes)
├─ supabase/schema.sql Tablas, RLS, auditoría por trigger
└─ .github/workflows/deploy.yml  Pruebas + build + GitHub Pages
```

- **Lectura QR:** [`@zxing/browser`](https://github.com/zxing-js/browser), que funciona en Safari iOS y Chrome Android mediante `getUserMedia`. Se pide `facingMode: environment` (cámara trasera).
- **Persistencia:** siempre se escribe primero en IndexedDB. En modo sincronizado, los registros quedan `pending` hasta que Supabase confirma; el envío es idempotente (UUID generado en el cliente + `ON CONFLICT DO NOTHING`), así que los reintentos no duplican.
- **Hora:** `visited_at` lo fija la app en el instante de la lectura (UTC ISO‑8601). `event_date` es la fecha local en la zona configurada (por defecto `America/Santiago`).
- **PWA:** manifiesto + service worker (vite-plugin-pwa) para que la app cargue aunque falle la red del recinto. Se actualiza sola al publicar una versión nueva.

### Modos de almacenamiento

| | Local | Sincronizado |
|---|---|---|
| Dónde | IndexedDB de **este navegador en este dispositivo** | IndexedDB + Supabase |
| Compartido entre dispositivos | No | Sí (mismo `stand_id`) |
| Respaldo | No, exporta CSV con frecuencia | Base de datos de Supabase |
| Acceso | Quien tenga el dispositivo | Solo operadores autenticados y autorizados (RLS) |
| Sin conexión | Funciona | Guarda en el dispositivo y reintenta automáticamente |

> ⚠️ Safari puede borrar los datos de sitios web que no se usen durante 7 días. En modo local, exporta el CSV al final de cada jornada.

## Lectura de la credencial (OCR)

El QR de la credencial solo contiene un identificador, pero el nombre, la institución y el cargo van **impresos**:

```
┌──────────────────────────────┐
│  (cabecera del evento)       │
│            [QR]              │  ← en Edifica 2026 el QR va encima del bloque
│  Nombre y apellido           │  ← 1.ª línea  → attendee_name
│  Institución                 │  ← 2.ª línea  → attendee_institution
│  Cargo en la institución     │  ← 3.ª línea  → attendee_role
└──────────────────────────────┘
```

**Guía de encuadre** (`src/lib/guide.ts`, activada por defecto): sobre la cámara se dibuja dónde debe quedar cada parte de la credencial: **QR en el cuadro naranja, nombre en la banda verde, institución en la naranja y cargo en la azul**. Con cada lectura del QR la app comprueba su tamaño, posición y giro e indica «Acerca la cámara», «Aleja un poco la cámara», «Centra el QR…» o «Endereza la credencial». Solo cuando el QR coincide con el cuadro en 3 lecturas seguidas (cámara quieta, imagen nítida) se captura el fotograma y se abre la confirmación. «Registrar sin alinear» permite seguir sin esperar. Se desactiva en *Ajustes → Guía de encuadre de la credencial*.

Al detectar el QR, la app toma ese mismo fotograma de la cámara y lo lee con OCR ([tesseract.js](https://github.com/naptha/tesseract.js), modelo en español) **dentro del teléfono** (`src/lib/ocr.ts`, `src/lib/ocrName.ts`):

0. **Bajo el QR** (lo primero): zxing indica dónde está el QR. Se recorta la franja justo debajo, enderezada según los ejes del código (corrige giros e inclinación) y ampliada, y se lee línea a línea: nombre, institución y cargo. Las líneas no se unen aunque se toquen (en la credencial real la «g» del nombre baja hasta la institución). Si ahí no hay un nombre, se sigue con los pasos 1 y 2.
1. **Ubicar el bloque**: lectura de texto disperso en toda la imagen. Se busca la línea que parece un nombre de persona y que tiene **dos líneas debajo** (institución y cargo). Esa estructura evita confundir la cabecera del evento con el nombre, o tomar la institución como apellido cuando las tres líneas tienen el mismo tamaño.
2. **Releer ampliado**: se recorta solo ese bloque, se amplía y se lee línea a línea. Así se recuperan palabras cortadas o letras pequeñas o en cursiva. En orden: nombre, institución y cargo.
3. «MARÍA JOSÉ» se escribe como «María José» y se corrigen minúsculas sueltas del OCR («PÉREZ soTO»). La institución y el cargo se guardan tal como están impresos.
4. Los tres campos aparecen rellenados en el formulario, junto con una miniatura de la zona leída (solo en pantalla, no se guarda). El operador los verifica y pulsa «Registrar visita». «Volver a leer» captura otro fotograma.
5. Se guarda con `name_source = 'ocr'`. La próxima vez que se escanee ese mismo código se proponen el nombre, la institución y el cargo ya confirmados, sin volver a hacer OCR.

Con la foto de una credencial real de Edifica 2026 (tomada con la app en un iPhone) se obtienen los tres campos, también con la credencial girada ±12° o al revés; antes de este paso la app leía «Ela». En credenciales de prueba con el QR debajo, de distintos tamaños, tipografías e inclinaciones, también se obtienen los tres campos. Tarda ~0,2–0,5 s en un computador. En un teléfono tarda más, y con luz o enfoque deficientes la lectura puede fallar: el operador siempre puede corregir.

Privacidad: la imagen no se guarda ni se envía a ningún servicio. Los archivos del OCR (~6 MB) se sirven desde la propia app (`public/ocr`, copiados en `npm run build`), se descargan al iniciar la cámara por primera vez y quedan en caché para funcionar sin conexión. Se puede desactivar en *Ajustes → Leer la credencial con la cámara*, y la institución y el cargo en *Ajustes → Registrar institución y cargo*.

Prioridad del nombre: el QR (si lo trae explícito) va primero, luego una visita anterior confirmada del mismo código, luego el OCR y, por último, el nombre escrito a mano.

## Interpretación de los QR

El ejemplo real `BDFFE48F81E448617430250Enp` es un **identificador opaco**. No hay documentación pública que permita decodificarlo: una búsqueda web del valor exacto no devolvió resultados, y no se identificó una API oficial del sistema de acreditaciones. Por eso la app:

- lo guarda tal cual como `qr_identifier` (respetando mayúsculas y minúsculas) y pide el nombre al operador;
- solo propone un nombre si aparece **explícitamente** en el contenido (vCard `FN`/`N`, MECARD `N:`, JSON con clave de nombre, parámetro `name`/`nombre` en una URL), y siempre lo deja editable;
- **nunca abre URLs** ni envía códigos a servicios externos;
- si el organizador del evento facilita una integración oficial y autorizada, puede añadirse en `src/lib/qr.ts` sin cambiar el resto.

## Desarrollo

```bash
npm ci
npm run dev        # http://localhost:5173/Trazabilidad/ (localhost permite la cámara)
npm test           # 93 pruebas (Vitest + Testing Library + fake-indexeddb)
npm run build      # tsc + vite build → dist/
```

Para probar la cámara desde el celular en desarrollo hace falta HTTPS (p. ej. `npx vite --host` + un túnel HTTPS). En producción, GitHub Pages ya sirve por HTTPS.

## Despliegue (GitHub Pages)

El workflow `.github/workflows/deploy.yml` ejecuta pruebas y build en cada push a `main` y publica `dist/` con `actions/deploy-pages`. Permisos: `contents: read` global, y `pages: write` + `id-token: write` solo en el job de despliegue.

**Ajuste manual necesario (una sola vez):** en GitHub → *Settings → Pages → Build and deployment → Source*, elige **GitHub Actions**. Después vuelve a ejecutar el workflow (*Actions → Pruebas y despliegue → Re-run*) si el primer intento falló por no estar habilitado.

- `base` de Vite = `/Trazabilidad/`; todas las rutas de recursos son relativas al subdirectorio.
- La navegación usa `#/historial`, `#/metricas`… por lo que recargar nunca produce 404; además se publica un `404.html` de respaldo.

## Supabase (opcional)

Proyecto enlazado por defecto: `https://txkyhzlqzordftthjfxb.supabase.co` (URL y *publishable key* en `.github/workflows/deploy.yml`; son públicas por diseño). Consulta [`docs/SUPABASE.md`](docs/SUPABASE.md). Resumen: ejecutar `supabase/schema.sql`, crear usuarios operadores, registrarlos en `operators`, desactivar el registro público y poner la URL y la *publishable key* en Ajustes (o como variables del repositorio).

## Privacidad

Consulta [`PRIVACY.md`](PRIVACY.md): datos recogidos, aviso al asistente, retención y eliminación.
