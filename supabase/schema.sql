-- Trazabilidad · esquema para Supabase (PostgreSQL)
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → New query.
-- Es idempotente: puede ejecutarse de nuevo sin perder datos.
--
-- Modelo de acceso:
--   * Solo usuarios autenticados que figuren en public.operators pueden leer, crear o corregir visitas.
--   * Nadie puede borrar visitas desde el cliente (no hay política DELETE).
--   * Cada corrección de nombre, institución, cargo u observaciones queda registrada en public.visit_audit mediante trigger.
--   * La fecha/hora de la visita, el código y el stand no se pueden modificar después de creados.

-- ── Operadores autorizados ──────────────────────────────────────────────
create table if not exists public.operators (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- null = puede ver todos los stands; con valor = solo ese stand.
  stand_id   text,
  created_at timestamptz not null default now()
);
alter table public.operators enable row level security;

drop policy if exists "operators_read_self" on public.operators;
create policy "operators_read_self" on public.operators
  for select to authenticated
  using (user_id = (select auth.uid()));
-- Los operadores solo se dan de alta desde el SQL Editor (ver el final del archivo).
revoke all on public.operators from anon;
revoke insert, update, delete on public.operators from authenticated;
grant select on public.operators to authenticated;

-- ¿El usuario actual es operador del stand indicado?
create or replace function public.is_operator(p_stand_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.operators o
    where o.user_id = (select auth.uid())
      and (o.stand_id is null or o.stand_id = p_stand_id)
  );
$$;
revoke all on function public.is_operator(text) from public, anon;
grant execute on function public.is_operator(text) to authenticated;

-- ── Visitas ─────────────────────────────────────────────────────────────
create table if not exists public.visits (
  id            uuid primary key,
  attendee_name text check (attendee_name is null or char_length(attendee_name) between 1 and 120),
  qr_payload    text check (qr_payload is null or char_length(qr_payload) <= 2048),
  qr_identifier text check (qr_identifier is null or char_length(qr_identifier) <= 512),
  qr_kind       text not null default 'identifier'
                check (qr_kind in ('identifier', 'url', 'vcard', 'mecard', 'json', 'text', 'manual')),
  visited_at    timestamptz not null,
  event_date    date not null,
  stand_id      text not null check (char_length(stand_id) between 1 and 64),
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  -- clock_timestamp(): distinto por fila, necesario para la sincronización incremental.
  updated_at    timestamptz not null default clock_timestamp(),
  created_by    uuid not null default auth.uid() references auth.users (id),
  updated_by    uuid references auth.users (id),
  -- La hora del dispositivo no puede estar muy en el futuro.
  constraint visited_at_not_future check (visited_at <= now() + interval '1 hour')
);

create index if not exists visits_stand_updated_idx on public.visits (stand_id, updated_at);
create index if not exists visits_stand_identifier_idx on public.visits (stand_id, qr_identifier);
create index if not exists visits_event_date_idx on public.visits (event_date);

alter table public.visits enable row level security;

drop policy if exists "visits_select_operators" on public.visits;
create policy "visits_select_operators" on public.visits
  for select to authenticated
  using ((select public.is_operator(stand_id)));

drop policy if exists "visits_insert_operators" on public.visits;
create policy "visits_insert_operators" on public.visits
  for insert to authenticated
  with check ((select public.is_operator(stand_id)) and created_by = (select auth.uid()));

drop policy if exists "visits_update_operators" on public.visits;
create policy "visits_update_operators" on public.visits
  for update to authenticated
  using ((select public.is_operator(stand_id)))
  with check ((select public.is_operator(stand_id)));

-- Origen del nombre (manual, qr, ocr, previous). Añadido después de la primera versión del esquema.
alter table public.visits add column if not exists name_source text;
alter table public.visits drop constraint if exists visits_name_source_check;
alter table public.visits add constraint visits_name_source_check
  check (name_source is null or name_source in ('manual', 'qr', 'ocr', 'previous'));

-- Institución y cargo (2.ª y 3.ª línea de la credencial).
alter table public.visits add column if not exists attendee_institution text;
alter table public.visits add column if not exists attendee_role text;
alter table public.visits drop constraint if exists visits_affiliation_length_check;
alter table public.visits add constraint visits_affiliation_length_check
  check (char_length(coalesce(attendee_institution, '')) <= 120 and char_length(coalesce(attendee_role, '')) <= 120);

-- Sin política DELETE: el borrado solo es posible desde el panel de administración.
revoke all on public.visits from anon;
grant select, insert, update on public.visits to authenticated;

-- ── Imagen de la credencial ────────────────────────────────────────────
-- Franja con nombre, institución y cargo, para revisar y corregir la lectura OCR.
-- Archivo <id de la visita>.webp (o .jpg) en el bucket privado badge-images.
alter table public.visits add column if not exists image_path text;
alter table public.visits drop constraint if exists visits_image_path_check;
alter table public.visits add constraint visits_image_path_check
  check (image_path is null or image_path in (id::text || '.webp', id::text || '.jpg'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('badge-images', 'badge-images', false, 262144, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ¿El usuario actual es operador del stand de la visita a la que pertenece la imagen?
create or replace function public.can_access_badge_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.visits v
    where p_name in (v.id::text || '.webp', v.id::text || '.jpg')
      and public.is_operator(v.stand_id)
  );
$$;
revoke all on function public.can_access_badge_image(text) from public, anon;
grant execute on function public.can_access_badge_image(text) to authenticated;

-- Leer, subir y reemplazar (la subida usa upsert: necesita select + insert + update). Sin política de borrado.
drop policy if exists "badge_images_select" on storage.objects;
create policy "badge_images_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'badge-images' and (select public.can_access_badge_image(name)));

drop policy if exists "badge_images_insert" on storage.objects;
create policy "badge_images_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'badge-images' and (select public.can_access_badge_image(name)));

drop policy if exists "badge_images_update" on storage.objects;
create policy "badge_images_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'badge-images' and (select public.can_access_badge_image(name)))
  with check (bucket_id = 'badge-images' and (select public.can_access_badge_image(name)));

-- ── Auditoría de correcciones ──────────────────────────────────────────
create table if not exists public.visit_audit (
  id         bigint generated always as identity primary key,
  visit_id   uuid not null references public.visits (id) on delete cascade,
  stand_id   text not null,
  field      text not null,
  old_value  text,
  new_value  text,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id)
);
create index if not exists visit_audit_visit_idx on public.visit_audit (visit_id, changed_at);
alter table public.visit_audit enable row level security;

drop policy if exists "visit_audit_select_operators" on public.visit_audit;
create policy "visit_audit_select_operators" on public.visit_audit
  for select to authenticated
  using ((select public.is_operator(stand_id)));
-- Sin políticas de escritura: solo el trigger (security definer) inserta.
revoke all on public.visit_audit from anon;
grant select on public.visit_audit to authenticated;

create or replace function public.visits_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Campos inmutables: garantizan la trazabilidad del paso por el stand.
  if new.id <> old.id
     or new.visited_at <> old.visited_at
     or new.event_date <> old.event_date
     or new.stand_id <> old.stand_id
     or new.qr_identifier is distinct from old.qr_identifier
     or new.qr_payload is distinct from old.qr_payload
     or new.qr_kind <> old.qr_kind
     or new.created_at <> old.created_at
     or new.created_by <> old.created_by then
    raise exception 'Solo se pueden corregir el nombre, la institución, el cargo y las observaciones' using errcode = '22023';
  end if;

  if new.attendee_name is distinct from old.attendee_name then
    insert into public.visit_audit (visit_id, stand_id, field, old_value, new_value, changed_by)
    values (old.id, old.stand_id, 'attendee_name', old.attendee_name, new.attendee_name, auth.uid());
  end if;
  if new.attendee_institution is distinct from old.attendee_institution then
    insert into public.visit_audit (visit_id, stand_id, field, old_value, new_value, changed_by)
    values (old.id, old.stand_id, 'attendee_institution', old.attendee_institution, new.attendee_institution, auth.uid());
  end if;
  if new.attendee_role is distinct from old.attendee_role then
    insert into public.visit_audit (visit_id, stand_id, field, old_value, new_value, changed_by)
    values (old.id, old.stand_id, 'attendee_role', old.attendee_role, new.attendee_role, auth.uid());
  end if;
  if new.notes is distinct from old.notes then
    insert into public.visit_audit (visit_id, stand_id, field, old_value, new_value, changed_by)
    values (old.id, old.stand_id, 'notes', old.notes, new.notes, auth.uid());
  end if;

  new.updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists visits_before_update on public.visits;
create trigger visits_before_update
  before update on public.visits
  for each row execute function public.visits_before_update();

-- ── Alta de operadores (ejecutar por cada persona autorizada) ───────────
-- 1. Authentication → Users → Add user (correo + contraseña, "Auto confirm").
-- 2. Ejecutar:
--    insert into public.operators (user_id, stand_id)
--    select id, 'stand-1' from auth.users where email = 'operador@ejemplo.cl'
--    on conflict (user_id) do update set stand_id = excluded.stand_id;

-- ── Retención: borrar los datos de un evento terminado ─────────────────
--    delete from public.visits where event_date < current_date - interval '90 days';
--    Las imágenes no se borran con la visita: elimínalas en Storage → badge-images
--    (seleccionar los archivos → Delete). Sin la visita, ningún operador puede verlas.
