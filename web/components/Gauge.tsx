/* The sector-overlap gauge.

   Note what this does NOT do: there is no "corruption" end of the dial. The
   left side is "no signal", which is where the overwhelming majority of real
   trails land. If this needle sat on the right most of the time, the instrument
   would be broken, not the politicians. */
export function Gauge({ angle, size = 132 }: { angle: number; size?: number }) {
  const cx = 70, cy = 62, r = 46
  const arc = (from: number, to: number, color: string) => {
    const p = (deg: number) => {
      const rad = ((180 - deg) * Math.PI) / 180
      return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)]
    }
    const [x1, y1] = p(from), [x2, y2] = p(to)
    return <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`} stroke={color}
      strokeWidth="13" fill="none" strokeLinecap="butt" />
  }
  const rad = ((180 - (angle + 90)) * Math.PI) / 180
  const nx = cx + 34 * Math.cos(rad), ny = cy - 34 * Math.sin(rad)
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 140 84" aria-hidden style={{ flex: 'none' }}>
      {arc(2, 46, '#9fb3c9')}
      {arc(48, 92, '#a9c4e4')}
      {arc(94, 136, '#7fb6ea')}
      {arc(138, 178, '#e0a800')}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#16222f" strokeWidth="4" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6" fill="#16222f" />
      <circle cx={cx} cy={cy} r="2.4" fill="#fff" />
    </svg>
  )
}
