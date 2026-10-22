# Configurar la sincronización con Supabase

El modo sincronizado es opcional. Sin él, la app funciona en modo local (solo en el dispositivo).

**Proyecto enlazado:** `https://txkyhzlqzordftthjfxb.supabase.co`. La app publicada ya trae su URL y su *publishable key* en *Ajustes → Almacenamiento*. Para que funcione hay que completar los pasos 2 y 3 (tablas, operadores) y, en cada teléfono, elegir **Sincronizado** e iniciar sesión.

## 1. Crear el proyecto

1. Crea un proyecto en https://supabase.com (región cercana, p. ej. `South America (São Paulo)`).
2. *Project Settings → API*: copia la **Project URL** y la **publishable key** (`sb_publishable_…`) o, en proyectos antiguos, la **anon key**.
   - **Nunca** uses la `service_role` ni una `sb_secret_…` en la app: la interfaz las rechaza.

## 2. Crear las tablas y políticas

*SQL Editor → New query* → pega y ejecuta el contenido de [`supabase/schema.sql`](../supabase/schema.sql). Crea:

| Objeto | Propósito |
|---|---|
| `operators` | Lista de usuarios autorizados (opcionalmente limitados a un `stand_id`). |
| `visits` | Registros. RLS: solo operadores pueden `select`/`insert`/`update`; no hay `delete` desde el cliente. |
| `visit_audit` | Historial de correcciones de nombre, institución, cargo y observaciones, escrito por trigger. Solo lectura para operadores. |
| `visits_before_update` | Trigger que impide modificar hora, código o stand y audita cada corrección. |
| Bucket `badge-images` | Storage privado con la imagen del texto de cada credencial (`<id>.webp`, máx. 256 KB, solo WebP/JPEG). Solo operadores del stand de esa visita pueden subirla o verla; nadie puede borrarla desde la app. |

El rol `anon` (cualquiera que conozca la URL de la app) **no tiene acceso** a ninguna tabla.

## 3. Restringir el acceso

1. *Authentication → Sign In / Providers → Email*: **desactiva «Allow new users to sign up»** para que nadie pueda crearse una cuenta.
2. *Authentication → Users → Add user*: crea un usuario por operador (correo + contraseña, marcando *Auto Confirm User*).
3. Autoriza a cada operador en el SQL Editor:

```sql
insert into public.operators (user_id, stand_id)
select id, 'stand-1' from auth.users where email = 'operador@ejemplo.cl'
on conflict (user_id) do update set stand_id = excluded.stand_id;
-- stand_id = null → acceso a todos los stands (p. ej. coordinador).
```

4. *Authentication → URL Configuration*: pon como **Site URL** `https://blackmist02.github.io/Trazabilidad/`.

## 4. Conectar la app

Opción A, en cada dispositivo: **Ajustes → Almacenamiento → Sincronizado**, pega la URL y la publishable key, *Guardar conexión* e inicia sesión con la cuenta de operador.

Opción B, por defecto para todos (es lo que está configurado): el workflow compila la app con la URL y la *publishable key* del proyecto enlazado. Para cambiar de proyecto sin tocar el código, crea en GitHub → *Settings → Secrets and variables → Actions → Variables* `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (tienen prioridad) y vuelve a ejecutar el workflow. Son valores públicos por diseño: la seguridad la dan RLS y la autenticación.

El **Identificador del stand** de Ajustes debe coincidir con el `stand_id` autorizado del operador.

## 5. Comprobar

- Sin sesión, la barra superior muestra «Sin sesión · N pendientes» y los registros se guardan en el dispositivo.
- Tras iniciar sesión, pasa a «Sincronizado». Los registros del mismo stand hechos en otros teléfonos aparecen en el historial en ≤ 30 s.
- Prueba de seguridad: con la publishable key y sin sesión,
  `curl "$URL/rest/v1/visits?select=*" -H "apikey: $KEY"` debe devolver `[]` o un error de permisos, nunca datos.

## Comportamiento ante fallos

| Situación | Qué pasa |
|---|---|
| Sin conexión | Se guarda en IndexedDB como pendiente; se reintenta al volver la conexión y con espera exponencial (5 s → 2 min). |
| Reenvío tras un corte | El `id` es un UUID generado en el dispositivo y la inserción usa `ON CONFLICT DO NOTHING`: no se duplica. |
| Sesión caducada o usuario no autorizado | Estado «Sin permiso»; los registros siguen pendientes en el dispositivo. |
| Corrección mientras está sin conexión | Se envía al reconectar; el servidor registra el valor anterior en `visit_audit`. |
| Cerrar sesión y borrar copia local | Elimina del dispositivo solo los registros ya sincronizados; los pendientes se conservan. |

Limitación conocida: si dos dispositivos corrigen el mismo registro a la vez, prevalece la última corrección enviada; ambas quedan en `visit_audit`. Las correcciones hechas antes de la primera sincronización de un registro solo quedan en el historial local.
