/**
 * A minimal inline-SVG rating-trend line chart. Server-rendered from the
 * student's RatingEvents. Rust line, mono axis labels, no charting library.
 * Width responsive; height ~120px. Empty state handled by the caller (< 2 events).
 *
 * Points are mapped into the viewBox with a little padding. Y range is clamped
 * around the data so small deltas are still visible.
 */
export function RatingTrend({
  events,
}: {
  events: { rating: number; createdAt: Date }[];
}) {
  if (events.length < 2) return null;

  const W = 600;
  const H = 120;
  const PAD = 28;

  const ratings = events.map((e) => e.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const range = max - min || 1; // avoid divide-by-zero when flat

  const xFor = (i: number) => PAD + (i / (events.length - 1)) * (W - 2 * PAD);
  const yFor = (r: number) => H - PAD - ((r - min) / range) * (H - 2 * PAD);

  const points = events.map((e, i) => `${xFor(i)},${yFor(e.rating)}`).join(" ");
  const path = `M ${points}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: 120 }}
      role="img"
      aria-label="Rating trend over time"
    >
      {/* baseline */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--line)" strokeWidth={1} />
      {/* the rust trend line */}
      <polyline
        fill="none"
        stroke="var(--rust)"
        strokeWidth={1.5}
        points={points}
      />
      <path d={path} fill="none" stroke="none" />
      {/* axis labels */}
      <text x={PAD - 6} y={PAD + 4} textAnchor="end" fontSize={9} fill="var(--muted)" fontFamily="var(--font-geist-mono)">
        {max}
      </text>
      <text x={PAD - 6} y={H - PAD} textAnchor="end" fontSize={9} fill="var(--muted)" fontFamily="var(--font-geist-mono)">
        {min}
      </text>
    </svg>
  );
}
