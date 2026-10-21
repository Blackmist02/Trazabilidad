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

**No se recogen**: ubicación GPS, huella del dispositivo, fotos, datos de contacto ni información de terceros. Los códigos QR **no** se envían a ningún servicio para descifrarlos y las URL de los QR **no** se abren. La app no escribe nombres ni identificadores en los registros técnicos (consola).

Poder leer un QR **no autoriza** a usar los datos personales que contenga. El operador debe informar al asistente (la app muestra el aviso configurable en cada confirmación) y respetar su negativa.

## Dónde se guardan

- **Modo local:** solo en el navegador del dispositivo (IndexedDB). Cualquiera con acceso al teléfono desbloqueado puede verlos: usa bloqueo de pantalla.
- **Modo sincronizado:** además en Supabase, accesible solo para operadores autenticados y autorizados (RLS). Las sesiones las gestiona Supabase Auth; la app no guarda contraseñas.

## Retención y eliminación

Política recomendada (ajústala a tu organización y a la Ley 19.628 / Ley 21.719 de Chile):

1. **Durante el evento:** exportar CSV al final de cada jornada como respaldo.
2. **Al terminar el evento (≤ 7 días):** exportar el CSV definitivo, guardarlo en un repositorio con acceso restringido y **borrar los datos de todos los dispositivos** (*Ajustes → Eliminar datos de este dispositivo*, o *Cerrar sesión y borrar copia local*).
3. **En Supabase:** conservar como máximo 90 días salvo necesidad justificada; después ejecutar:
   ```sql
   delete from public.visits where event_date < current_date - interval '90 days';
   ```
   (`visit_audit` se borra en cascada).
4. **Solicitudes de eliminación de un asistente:** buscar su nombre o código en el Historial, y borrar en Supabase con `delete from public.visits where id = '…';` desde el SQL Editor (el cliente no permite borrar).
