import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { VisitStore } from './data/db';
import { AppProvider } from './state/store';

let n = 0;

function renderApp() {
  const store = new VisitStore(`ui-${++n}`);
  window.location.hash = '';
  render(
    <AppProvider store={store}>
      <App />
    </AppProvider>,
  );
  return store;
}

async function enterManually(code: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Introducir código manualmente' }));
  fireEvent.change(screen.getByLabelText('Código de la credencial'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
  await screen.findByRole('dialog');
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('flujo de registro', () => {
  it('registra una visita introducida manualmente con nombre', async () => {
    const store = renderApp();
    expect(screen.getByText('Local · solo este dispositivo')).toBeTruthy();
    await enterManually('BDFFE48F81E448617430250Enp');
    expect(screen.getByText('El código no contiene un nombre. Pregúntalo al visitante.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Nombre del asistente'), { target: { value: 'Ana Pérez' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Registrar visita' }));
    });
    await screen.findByText(/Registrado: Ana Pérez/);
    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ attendee_name: 'Ana Pérez', qr_identifier: 'BDFFE48F81E448617430250Enp', sync_state: 'local' });
  });

  it('advierte de una visita previa el mismo día y propone el nombre conocido', async () => {
    const store = renderApp();
    await enterManually('CODE-12345');
    fireEvent.change(screen.getByLabelText('Nombre del asistente'), { target: { value: 'Luis Soto' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Registrar visita' }));
    });
    await screen.findByText(/Registrado: Luis Soto/);

    await enterManually('CODE-12345');
    expect(screen.getByText(/Este código ya se registró hoy/)).toBeTruthy();
    expect((screen.getByLabelText('Nombre del asistente') as HTMLInputElement).value).toBe('Luis Soto');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await store.all()).toHaveLength(1); // cancelar no crea registro
  });

  it('permite registrar sin nombre y lo marca como pendiente en el historial', async () => {
    renderApp();
    await enterManually('XYZ999888');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Registrar sin nombre' }));
    });
    await screen.findByText(/Registrado sin nombre/);
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }));
    expect(await screen.findByText('Pendiente de nombre')).toBeTruthy();
  });

  it('una doble pulsación en «Registrar» crea un solo registro', async () => {
    const store = renderApp();
    await enterManually('DOUBLE-TAP-1');
    fireEvent.change(screen.getByLabelText('Nombre del asistente'), { target: { value: 'Eva' } });
    const btn = screen.getByRole('button', { name: 'Registrar visita' });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    await screen.findByText(/Registrado: Eva/);
    expect(await store.all()).toHaveLength(1);
  });
});
