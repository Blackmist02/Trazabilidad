# Privacidad y retención de datos

## Datos que se registran

| Campo | Motivo |
|---|---|
| Nombre del asistente | Identificar quién visitó el stand (lo introduce o confirma el operador). |
| Identificador del QR | Detectar visitas repetidas sin depender del nombre. |
| Contenido original del QR | Solo si difiere del identificador (p. ej. una URL) y la opción está activa en Ajustes. |
| Fecha y hora (UTC) y fecha local | Medir la afluencia. |
| Stand | Separar los registros de cada stand. |
| Observaciones | Opcional; no anotes datos sensibles (salud, religión, etc.). |

| Origen del nombre | Trazabilidad: si lo escribió el operador, venía en el QR, se leyó de la credencial (OCR) o se tomó de una visita anterior. |
| Institución y cargo | Opcionales; impresos en la credencial (2.ª y 3.ª línea). Permiten saber qué instituciones visitan el stand. Se pueden desactivar en Ajustes. |
| Imagen de la credencial | Solo la franja con nombre, institución y cargo (no la cara ni el resto de la imagen), ~15–40 KB. Sirve para revisar y corregir lo que leyó el OCR. Se puede desactivar en *Ajustes → Guardar imagen de la credencial*. |

**Lectura de la credencial (OCR):** se analiza en el propio teléfono el fotograma en que se detectó el QR para proponer el nombre, la institución y el cargo impresos. En la confirmación se muestra una miniatura de la zona leída para que el operador compruebe la lectura; se descarta al cerrar la confirmación. La imagen no se guarda, no se exporta y no se envía a ningún servicio. Solo se conservan los datos que el operador confirma.

**No se recogen**: ubicación GPS, huella del dispositivo, fotos del asistente ni del entorno (solo la franja de texto de la credencial descrita arriba), datos de contacto ni información de terceros. Los códigos QR **no** se envían a ningún servicio para descifrarlos y las URL de los QR **no** se abren. La app no escribe nombres ni identificadores en los registros técnicos (consola).

Poder leer un QR **no autoriza** a usar los datos personales que contenga. El operador debe informar al asistente (la app muestra el aviso configurable en cada confirmación) y respetar su negativa.

## Dónde se guardan

- **Modo local:** solo en el navegador del dispositivo (IndexedDB). Cualquiera con acceso al teléfono desbloqueado puede verlos: usa bloqueo de pantalla.
- **Modo sincronizado:** además en Supabase, accesible solo para operadores autenticados y autorizados (RLS). Las imágenes van en el bucket privado `badge-images`, con las mismas reglas. Las sesiones las gestiona Supabase Auth; la app no guarda contraseñas.

## Retención y eliminación

Política recomendada (ajústala a tu organización y a la Ley 19.628 / Ley 21.719 de Chile):

1. **Durante el evento:** exportar CSV al final de cada jornada como respaldo.
2. **Al terminar el evento (≤ 7 días):** exportar el CSV definitivo, guardarlo en un repositorio con acceso restringido y **borrar los datos de todos los dispositivos** (*Ajustes → Eliminar datos de este dispositivo*, o *Cerrar sesión y borrar copia local*).
3. **En Supabase:** conservar como máximo 90 días salvo necesidad justificada; después ejecutar:
   ```sql
   delete from public.visits where event_date < current_date - interval '90 days';
   ```
   (`visit_audit` se borra en cascada). Las imágenes se borran aparte: *Storage → badge-images*, seleccionar y *Delete*.
4. **Solicitudes de eliminación de un asistente:** buscar su nombre o código en el Historial, y borrar en Supabase con `delete from public.visits where id = '…';` desde el SQL Editor (el cliente no permite borrar), y su imagen `<id>.webp` (o `.jpg`) en *Storage → badge-images*.
