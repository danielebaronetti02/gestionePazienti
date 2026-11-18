// Grafico a linee dell'andamento di un esame (SVG, nessuna libreria).
import { num } from "../format";

const LINE = "#1f5f8b";
const GRID = "#e1e6eb";
const AXIS = "#cdd5dd";
const LABEL = "#6b7785";
const MIN_LABEL_GAP = 62;

/** Estremi e passo "tondi" (1, 2, 2.5, 5 × 10^n) per l'asse Y. */
function niceScale(lo, hi, nTicks = 4) {
  const dataMin = lo;
  if (lo === hi) {
    lo -= Math.abs(lo) * 0.1 || 1;
    hi += Math.abs(hi) * 0.1 || 1;
  }
  const rawStep = (hi - lo) / nTicks;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rawStep);
  lo = Math.floor((lo - step * 0.3) / step) * step;
  hi = Math.ceil((hi + step * 0.3) / step) * step;
  if (dataMin >= 0 && lo < 0) lo = 0;
  const ticks = [];
  for (let i = 0; i <= Math.round((hi - lo) / step); i++) ticks.push(lo + i * step);
  return { lo, hi, ticks };
}

const toDate = (iso) => new Date(iso + "T00:00:00");
const shortDate = (d) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;

/** Etichette dell'asse X: sempre prima e ultima, le intermedie solo se non si sovrappongono. */
function dateLabels(coords) {
  const lastX = coords[coords.length - 1].x;
  const labels = [];
  let prev = -1e9;
  coords.forEach((c, i) => {
    const isLast = i === coords.length - 1;
    if (isLast || (c.x - prev >= MIN_LABEL_GAP && lastX - c.x >= MIN_LABEL_GAP)) {
      if (isLast && labels.length > 1 && c.x - prev < MIN_LABEL_GAP) labels.pop();
      labels.push(c);
      prev = c.x;
    }
  });
  return labels;
}

export function TrendChart({ points, unit = "", width = 560, height = 230 }) {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length < 2) return null;
  const [pl, pr, pt, pb] = [52, 16, 14, 40];
  const w = width - pl - pr;
  const h = height - pt - pb;
  const dates = sorted.map((p) => toDate(p.date));
  const vals = sorted.map((p) => p.value);
  const d0 = dates[0];
  const d1 = dates[dates.length - 1];
  const spanDays = Math.max((d1 - d0) / 86400000, 1);
  const { lo, hi, ticks } = niceScale(Math.min(...vals), Math.max(...vals));
  const x = (d) => (d1 - d0 === 0 ? pl + w / 2 : pl + ((d - d0) / 86400000 / spanDays) * w);
  const y = (v) => pt + ((hi - v) / (hi - lo)) * h;
  const coords = sorted.map((p, i) => ({ ...p, x: x(dates[i]), y: y(p.value), date: dates[i] }));
  const labels = dateLabels(coords);
  const showValues = sorted.length <= 10;

  return (
    <svg className="trend" viewBox={`0 0 ${width} ${height}`} role="img">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pl} x2={width - pr} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth="1" />
          <text x={pl - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill={LABEL}>
            {num(v)}
          </text>
        </g>
      ))}
      <polyline
        fill="none"
        stroke={LINE}
        strokeWidth="2.2"
        strokeLinejoin="round"
        points={coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ")}
      />
      {labels.map((c, i) => (
        <text
          key={c.date.toISOString()}
          x={c.x}
          y={height - pb + 18}
          textAnchor={i === labels.length - 1 && labels.length > 1 ? "end" : i === 0 ? "start" : "middle"}
          fontSize="11"
          fill={LABEL}
        >
          {shortDate(c.date)}
        </text>
      ))}
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r="4" fill="#fff" stroke={LINE} strokeWidth="2">
            <title>{`${shortDate(c.date)}: ${c.raw} ${unit}`}</title>
          </circle>
          {showValues && (
            <text x={c.x} y={c.y - 9} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1d2733">
              {num(c.value)}
            </text>
          )}
        </g>
      ))}
      <line x1={pl} x2={width - pr} y1={pt + h} y2={pt + h} stroke={AXIS} />
    </svg>
  );
}

/** Riquadro con titolo e riepilogo (ultimo, min, max) sopra al grafico. */
export function TrendBox({ series }) {
  const pts = [...series.points].sort((a, b) => (a.date < b.date ? -1 : 1));
  const vals = pts.map((p) => p.value);
  const last = pts[pts.length - 1];
  const [y, m, d] = last.date.split("-");
  return (
    <figure className="trend-box">
      <figcaption>
        <strong>{series.name}</strong> <span className="muted">{series.unit}</span>
        <span className="trend-meta">
          ultimo {num(last.value)} ({`${d}/${m}/${y}`}) · min {num(Math.min(...vals))} · max {num(Math.max(...vals))} ·{" "}
          {vals.length} valori
        </span>
      </figcaption>
      <TrendChart points={series.points} unit={series.unit} />
    </figure>
  );
}
