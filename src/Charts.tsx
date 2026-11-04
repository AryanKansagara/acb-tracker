import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { addDays, cad, splitAdjustedSeries, type SuperficialEvent, type Security, type TaxYear, type Tx } from './engine.ts'
import { shares, signed } from './ui.tsx'

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(720)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const toMs = (d: string) => Date.parse(d + 'T00:00:00Z')

function ticks(min: number, max: number, count = 4) {
  const span = max - min || Math.abs(max) || 1
  const raw = span / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) out.push(+v.toFixed(6))
  return out
}

const short = (n: number) => (Math.abs(n) >= 1000 ? `${n < 0 ? '-' : ''}$${(Math.abs(n) / 1000).toLocaleString('en-CA', { maximumFractionDigits: 1 })}k` : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-CA', { maximumFractionDigits: 2 })}`)

function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const flip = x > width - 200
  return (
    <div className="chart-tip" style={{ left: flip ? undefined : x + 12, right: flip ? width - x + 12 : undefined, top: Math.max(0, y - 10) }}>
      {children}
    </div>
  )
}

const Triangle = ({ x, y, up, cls }: { x: number; y: number; up: boolean; cls: string }) => (
  <path className={cls} d={up ? `M${x} ${y - 6}l6 10h-12z` : `M${x} ${y + 6}l6 -10h-12z`} />
)

/** ACB per share as a step line, with the prices you actually traded at. Prices are your trades, not a market feed. */
export function AcbChart({ sec }: { sec: Security }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const pts = useMemo(() => splitAdjustedSeries(sec), [sec])
  const H = 300
  const m = { t: 16, r: 16, b: 28, l: 56 }
  if (!pts.length) return null

  const t0 = toMs(pts[0].date)
  const t1 = Math.max(toMs(pts[pts.length - 1].date), t0 + 86_400_000 * 30)
  const vals = pts.flatMap((p) => [p.acbPerShare, p.price]).filter((v): v is number => v != null && v > 0)
  const ys = ticks(Math.min(...vals) * 0.96, Math.max(...vals) * 1.04)
  const [y0, y1] = [ys[0], ys[ys.length - 1]]
  const X = (d: string) => m.l + ((toMs(d) - t0) / (t1 - t0)) * (width - m.l - m.r)
  const Y = (v: number) => H - m.b - ((v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b)

  let path = ''
  let prev: number | null = null
  for (const p of pts) {
    if (p.acbPerShare == null) {
      prev = null
      continue
    }
    path += prev == null ? `M${X(p.date)} ${Y(p.acbPerShare)}` : `H${X(p.date)}V${Y(p.acbPerShare)}`
    prev = p.acbPerShare
  }
  const lastAcb = pts[pts.length - 1].acbPerShare
  if (lastAcb != null) path += `H${width - m.r}`

  // Label the first year at the left edge too, unless the next January would collide with it.
  const years: string[] = []
  const firstJan = `${+pts[0].date.slice(0, 4) + 1}-01-01`
  if (X(firstJan) - m.l > 48) years.push(pts[0].date)
  for (let y = +pts[0].date.slice(0, 4) + 1; y <= +pts[pts.length - 1].date.slice(0, 4); y++) years.push(`${y}-01-01`)

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - box.left
    let best = 0
    pts.forEach((p, i) => {
      if (Math.abs(X(p.date) - x) <= Math.abs(X(pts[best].date) - x)) best = i
    })
    setHover(best)
  }
  const h = hover == null ? null : pts[hover]

  return (
    <div className="chart" ref={ref}>
      <ul className="legend">
        <li><i className="key line" />ACB per share</li>
        <li><i className="key up" />Your buy price</li>
        <li><i className="key down" />Your sell price</li>
      </ul>
      <div className="chart-plot">
        <svg width={width} height={H} role="img" aria-label={`ACB per share compared with trade prices for ${sec.symbol}. Every value is in the ledger table below.`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {ys.map((v) => (
            <g key={v}>
              <line className="grid" x1={m.l} x2={width - m.r} y1={Y(v)} y2={Y(v)} />
              <text className="tick" x={m.l - 8} y={Y(v) + 4} textAnchor="end">{short(v)}</text>
            </g>
          ))}
          {years.map((d) => (
            <text key={d} className="tick" x={X(d)} y={H - 8} textAnchor={d === pts[0].date ? 'start' : 'middle'}>{d.slice(0, 4)}</text>
          ))}
          <path className="acb-line" d={path} />
          {pts.map((p, i) => (p.price != null && p.side ? <Triangle key={i} x={X(p.date)} y={Y(p.price)} up={p.side === 'buy'} cls={p.side === 'buy' ? 'mark-up' : 'mark-down'} /> : null))}
          {h && <line className="crosshair" x1={X(h.date)} x2={X(h.date)} y1={m.t} y2={H - m.b} />}
        </svg>
        {h && (
          <Tip x={X(h.date)} y={h.acbPerShare != null ? Y(h.acbPerShare) : m.t} width={width}>
            <b>{h.date}</b>
            <span>ACB per share {h.acbPerShare != null ? cad(h.acbPerShare) : 'none held'}</span>
            {h.price != null && <span>{h.side === 'buy' ? 'Bought' : 'Sold'} at {cad(h.price)}</span>}
            <span>{shares(h.row.shares)} shares held then</span>
          </Tip>
        )}
      </div>
    </div>
  )
}

/** Allowed gains above zero, allowed losses below, one column per tax year. */
export function GainsChart({ years }: { years: TaxYear[] }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const H = 260
  const m = { t: 16, r: 12, b: 28, l: 56 }
  const ys = ticks(Math.min(0, ...years.map((y) => y.losses)), Math.max(0, ...years.map((y) => y.gains)))
  const [y0, y1] = [ys[0], ys[ys.length - 1]]
  const Y = (v: number) => H - m.b - ((v - y0) / (y1 - y0 || 1)) * (H - m.t - m.b)
  const band = (width - m.l - m.r) / Math.max(years.length, 1)
  const bw = Math.min(56, band * 0.5)
  const h = hover == null ? null : years[hover]

  return (
    <div className="chart" ref={ref}>
      <ul className="legend">
        <li><i className="key bar-gain" />Gains</li>
        <li><i className="key bar-loss" />Losses (after denials)</li>
      </ul>
      <div className="chart-plot">
        <svg width={width} height={H} role="img" aria-label="Realized capital gains and losses by tax year. The Schedule 3 tab has the same numbers as a table." onPointerLeave={() => setHover(null)}>
          {ys.map((v) => (
            <g key={v}>
              <line className={v === 0 ? 'axis' : 'grid'} x1={m.l} x2={width - m.r} y1={Y(v)} y2={Y(v)} />
              <text className="tick" x={m.l - 8} y={Y(v) + 4} textAnchor="end">{short(v)}</text>
            </g>
          ))}
          {years.map((y, i) => {
            const x = m.l + band * i + band / 2 - bw / 2
            return (
              <g key={y.year} onPointerEnter={() => setHover(i)}>
                <rect className="hit" x={m.l + band * i} y={m.t} width={band} height={H - m.t - m.b} />
                {y.gains > 0 && <path className="bar-gain" d={roundedBar(x, Y(y.gains), bw, Y(0) - Y(y.gains) - 1, true)} />}
                {y.losses < 0 && <path className="bar-loss" d={roundedBar(x, Y(0) + 1, bw, Y(y.losses) - Y(0) - 1, false)} />}
                <text className="tick strong" x={x + bw / 2} y={H - 8} textAnchor="middle">{y.year}</text>
              </g>
            )
          })}
        </svg>
        {h && (
          <Tip x={m.l + band * hover! + band / 2} y={40} width={width}>
            <b>{h.year}</b>
            <span>Gains {cad(h.gains)}</span>
            <span>Losses {cad(h.losses)}</span>
            <span>Net {signed(h.net)}</span>
            {h.denied > 0 && <span>Denied as superficial {cad(h.denied)}</span>}
          </Tip>
        )}
      </div>
    </div>
  )
}

function roundedBar(x: number, y: number, w: number, h: number, top: boolean) {
  const r = Math.min(4, Math.max(h, 0))
  const hh = Math.max(h, 1)
  return top
    ? `M${x} ${y + hh}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + hh}Z`
    : `M${x} ${y}V${y + hh - r}Q${x} ${y + hh} ${x + r} ${y + hh}H${x + w - r}Q${x + w} ${y + hh} ${x + w} ${y + hh - r}V${y}Z`
}

/** The 61-day window around a losing sale, with each acquisition placed on it. */
export function WindowTimeline({ ev, txs }: { ev: SuperficialEvent; txs: Tx[] }) {
  const [ref, width] = useWidth()
  const pad = 24
  const X = (d: string) => pad + ((toMs(d) - toMs(ev.windowStart)) / (61 * 86_400_000)) * (width - pad * 2)
  const buys = txs.filter((t) => t.symbol.toUpperCase() === ev.symbol && t.kind === 'buy' && t.date >= ev.windowStart && t.date <= addDays(ev.windowEnd, 0))
  return (
    <div className="timeline" ref={ref}>
      <svg width={width} height={84} role="img" aria-label={`Window from ${ev.windowStart} to ${ev.windowEnd}, with the sale on ${ev.date} and ${buys.length} purchases inside it.`}>
        <rect className="tl-window" x={pad} y={34} width={width - pad * 2} height={8} rx={4} />
        <text className="tick" x={pad} y={66}>{ev.windowStart}</text>
        <text className="tick" x={width - pad} y={66} textAnchor="end">{ev.windowEnd}</text>
        <g>
          <Triangle x={X(ev.date)} y={38} up={false} cls="mark-down" />
          <text className="tick strong" x={X(ev.date)} y={22} textAnchor="middle">Sold {shares(ev.sold)}</text>
        </g>
        {buys.map((b) => (
          <g key={b.id}>
            <Triangle x={X(b.date)} y={38} up cls="mark-up" />
            <text className="tick strong" x={X(b.date)} y={width < 500 ? 80 : 66} textAnchor="middle">
              +{shares(b.quantity)}{b.accountType !== 'Non-registered' ? ` ${b.accountType}` : ''}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}
