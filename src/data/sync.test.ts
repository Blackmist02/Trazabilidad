import { describe, expect, it } from 'vitest';
import { parseQr } from '../lib/qr';
import { applyEdit, createVisit, type Visit } from '../lib/visits';
import { VisitStore } from './db';
import { classifyRemoteError, RemoteError, type RemoteVisitRow, type RemoteVisits, type VisitChanges } from './remote';
import { syncOnce } from './sync';

let dbCounter = 0;
const newStore = () => new VisitStore(`test-${++dbCounter}`);

function visit(code: string, name: string | null, syncMode = true): Visit {
  return createVisit({
    parsed: parseQr(code),
    attendeeName: name,
    notes: null,
    scannedAt: new Date('2026-10-21T15:00:00Z'),
    standId: 'stand-1',
    timeZone: 'America/Santiago',
    storePayload: false,
    syncMode,
  });
}

/** Servidor simulado: guarda filas por id e ignora inserciones duplicadas, como el upsert real. */
class FakeRemote implements RemoteVisits {
  rows = new Map<string, RemoteVisitRow>();
  inserts = 0;
  updates: { id: string; attendee_name: string | null }[] = [];
  failWith: unknown = null;
  private clock = 0;

  private stamp(): string {
    return new Date(Date.UTC(2026, 9, 21, 20, 0, 0, ++this.clock)).toISOString();
  }
  async insert(rows: RemoteVisitRow[]) {
    if (this.failWith) throw this.failWith;
    this.inserts++;
    for (const r of rows) if (!this.rows.has(r.id)) this.rows.set(r.id, { ...r, updated_at: this.stamp() });
  }
  async update(id: string, changes: VisitChanges) {
    if (this.failWith) throw this.failWith;
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, ...changes, updated_at: this.stamp() });
    this.updates.push({ id, attendee_name: changes.attendee_name });
  }
  async fetchSince(standId: string, since: string | null, limit: number) {
    if (this.failWith) throw this.failWith;
    return [...this.rows.values()]
      .filter((r) => r.stand_id === standId && (!since || (r.updated_at ?? '') > since))
      .sort((a, b) => (a.updated_at ?? '').localeCompare(b.updated_at ?? ''))
      .slice(0, limit);
  }
}

describe('syncOnce', () => {
  it('envía registros pendientes y los marca como sincronizados', async () => {
    const store = newStore();
    const remote = new FakeRemote();
    await store.put(visit('AAA111', 'Ana'));
    await store.put(visit('BBB222', null));
    const r = await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    expect(r.phase).toBe('idle');
    expect(r.pushed).toBe(2);
    expect(r.pending).toBe(0);
    expect(remote.rows.size).toBe(2);
    expect((await store.all()).every((v) => v.sync_state === 'synced')).toBe(true);
  });

  it('reintentar no duplica registros en el servidor', async () => {
    const store = newStore();
    const remote = new FakeRemote();
    const v = visit('AAA111', 'Ana');
    await store.put(v);
    await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    // Simula que la confirmación se perdió: el registro vuelve a estar pendiente.
    await store.put({ ...v, sync_state: 'pending' });
    await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    expect(remote.rows.size).toBe(1);
  });

  it('sin conexión no intenta enviar y conserva los pendientes', async () => {
    const store = newStore();
    const remote = new FakeRemote();
    await store.put(visit('AAA111', 'Ana'));
    const r = await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => false });
    expect(r.phase).toBe('offline');
    expect(r.pending).toBe(1);
    expect(remote.inserts).toBe(0);
  });

  it('error de red de Supabase: queda pendiente para reintentar', async () => {
    const store = newStore();
    const remote = new FakeRemote();
    remote.failWith = new TypeError('Failed to fetch');
    await store.put(visit('AAA111', 'Ana'));
    const r = await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    expect(r.phase).toBe('offline');
    expect(r.pending).toBe(1);
    expect((await store.all())[0].sync_state).toBe('pending');

    remote.failWith = null;
    const r2 = await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    expect(r2.phase).toBe('idle');
    expect(r2.pending).toBe(0);
  });

  it('error de permisos (RLS) se informa como no autorizado sin perder datos', async () => {
    const store = newStore();
    const remote = new FakeRemote();
    remote.failWith = { code: '42501', message: 'new row violates row-level security policy' };
    await store.put(visit('AAA111', 'Ana'));
    const r = await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    expect(r.phase).toBe('unauthorized');
    expect(r.pending).toBe(1);
    expect(r.error).not.toContain('Ana'); // los mensajes no incluyen datos personales
  });

  it('envía correcciones de nombre de registros ya sincronizados', async () => {
    const store = newStore();
    const remote = new FakeRemote();
    const v = visit('AAA111', null);
    await store.put(v);
    await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    const synced = (await store.get(v.id))!;
    await store.put(applyEdit(synced, { attendee_name: 'Ana Pérez' }));
    await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    expect(remote.rows.get(v.id)?.attendee_name).toBe('Ana Pérez');
    expect(remote.updates).toEqual([{ id: v.id, attendee_name: 'Ana Pérez' }]);
    expect((await store.get(v.id))?.dirty).toBe(false);
  });

  it('descarga registros de otros dispositivos del mismo stand, no de otros stands', async () => {
    const store = newStore();
    const remote = new FakeRemote();
    const other = visit('ZZZ999', 'Otro');
    const otherStand = { ...visit('YYY888', 'Ajeno'), stand_id: 'stand-2' };
    await remote.insert([other, otherStand].map((x) => ({ ...x, qr_kind: x.qr_kind })));
    const r = await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    expect(r.pulled).toBe(1);
    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0].attendee_name).toBe('Otro');
    expect(all[0].sync_state).toBe('synced');
    // Segunda pasada: nada nuevo.
    expect((await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true })).pulled).toBe(0);
  });

  it('un cambio local pendiente no se pisa con la versión remota', async () => {
    const store = newStore();
    const remote = new FakeRemote();
    const v = visit('AAA111', 'Ana');
    await store.put(v);
    await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    const edited = applyEdit((await store.get(v.id))!, { attendee_name: 'Ana María' });
    await store.put(edited);
    remote.failWith = new TypeError('Failed to fetch');
    await syncOnce({ store, remote, standId: 'stand-1', isOnline: () => true });
    expect((await store.get(v.id))?.attendee_name).toBe('Ana María');
  });
});

describe('classifyRemoteError', () => {
  it('clasifica errores comunes', () => {
    expect(classifyRemoteError(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(classifyRemoteError({ code: 'PGRST301' }).kind).toBe('unauthorized');
    expect(classifyRemoteError({ message: 'x' }, 401).kind).toBe('unauthorized');
    expect(classifyRemoteError({ code: '23514' }).kind).toBe('invalid');
    expect(classifyRemoteError({ code: 'XX000' }, 500).kind).toBe('server');
    const e = new RemoteError('network', 'x');
    expect(classifyRemoteError(e)).toBe(e);
  });
});
