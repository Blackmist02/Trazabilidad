import { useState } from 'react';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Texto completo para la ayuda emergente / lector de pantalla. */
  title: string;
}

/** Barras verticales de una sola serie; tocar o pasar el cursor muestra el valor exacto. */
export function BarChart({ data, ariaLabel }: { data: BarDatum[]; ariaLabel: string }) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const current = data.find((d) => d.key === active);
  const labelEvery = data.length > 12 ? Math.ceil(data.length / 8) : 1;
  return (
    <figure className="chart" aria-label={ariaLabel}>
      <div className="chart-readout" aria-live="polite">
        {current ? current.title : <span className="muted">Toca una barra para ver el detalle</span>}
      </div>
      <div className="bars" role="list" onMouseLeave={() => setActive(null)}>
        {data.map((d, i) => (
          <button
            type="button"
            role="listitem"
            key={d.key}
            className={`bar-slot ${active === d.key ? 'is-active' : ''}`}
            onMouseEnter={() => setActive(d.key)}
            onFocus={() => setActive(d.key)}
            onClick={() => setActive(d.key)}
            aria-label={d.title}
          >
            <span className="bar-track">
              <span className="bar" style={{ height: `${(d.value / max) * 100}%` }} />
            </span>
            <span className="bar-label">{i % labelEvery === 0 ? d.label : ''}</span>
          </button>
        ))}
      </div>
    </figure>
  );
}

export interface LinePoint {
  key: string;
  label: string;
  value: number;
  title: string;
}

/** Línea de acumulado con marcador seleccionable. */
export function LineChart({ data, ariaLabel }: { data: LinePoint[]; ariaLabel: string }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const W = 320;
  const H = 140;
  const pad = { l: 4, r: 4, t: 8, b: 8 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const x = (i: number) => pad.l + (data.length <= 1 ? (W - pad.l - pad.r) / 2 : (i / (data.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const area = data.length ? `${path} L${x(data.length - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z` : '';
  const active = activeIdx !== null ? data[activeIdx] : data[data.length - 1];

  function pick(clientX: number, rect: DOMRect) {
    if (!data.length) return;
    const rel = ((clientX - rect.left) / rect.width) * W;
    const i = data.length <= 1 ? 0 : Math.round(((rel - pad.l) / (W - pad.l - pad.r)) * (data.length - 1));
    setActiveIdx(Math.min(data.length - 1, Math.max(0, i)));
  }

  return (
    <figure className="chart" aria-label={ariaLabel}>
      <div className="chart-readout" aria-live="polite">
        {active ? active.title : <span className="muted">Sin datos</span>}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="line-chart"
        preserveAspectRatio="none"
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setActiveIdx(null)}
        role="img"
        aria-label={ariaLabel}
      >
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="axis" />
        {area && <path d={area} className="line-area" />}
        {path && <path d={path} className="line" vectorEffect="non-scaling-stroke" />}
        {activeIdx !== null && data[activeIdx] && (
          <line x1={x(activeIdx)} x2={x(activeIdx)} y1={pad.t} y2={H - pad.b} className="crosshair" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {data.length > 0 && (
        <div className="line-labels">
          <span>{data[0].label}</span>
          <span>{data[data.length - 1].label}</span>
        </div>
      )}
    </figure>
  );
}
