import { useEffect, useMemo, useState } from 'react'
import { cad, computeAcb, KIND_LABEL, type LedgerRow } from './engine.ts'
import { HERO_TRADES } from './samples.ts'
import { Gain, prefersReducedMotion, shares, useTween } from './ui.tsx'

const N = HERO_TRADES.length

const label = (r: LedgerRow) => {
  if (r.kind === 'superficial-adj') return 'Denied loss added to ACB'
  if (r.kind === 'buy' || r.kind === 'sell') return `${KIND_LABEL[r.kind]} ${shares(r.quantity)} at ${cad(r.tx.price)}`
  return KIND_LABEL[r.kind]
}

function Figure({ name, value, format }: { name: string; value: number; format: (n: number) => string }) {
  const v = useTween(value)
  return (
    <div className="hero-figure">
      <dt>{name}</dt>
      <dd>{format(v)}</dd>
    </div>
  )
}

/** Runs the real engine over a growing slice of trades, so a later buyback rewrites an earlier loss. */
export default function HeroLedger() {
  const [still] = useState(prefersReducedMotion)
  const [k, setK] = useState(still ? N : 1)
  const [playing, setPlaying] = useState(!still)

  useEffect(() => {
    if (!playing) return
    const id = setTimeout(() => setK((x) => (x >= N ? 1 : x + 1)), k >= N ? 7000 : 1800)
    return () => clearTimeout(id)
  }, [k, playing])

  const sec = useMemo(() => computeAcb(HERO_TRADES.slice(0, k)).securities[0], [k])
  const denied = sec.rows.find((r) => r.denied)
  const last = sec.rows[sec.rows.length - 1]

  return (
    <figure className="hero-ledger" aria-label="Sample ledger computing adjusted cost base as trades arrive">
      <div className="hero-ledger-head">
        <div>
          <span className="eyebrow">Live ledger</span>
          <strong>XEQT, across two accounts</strong>
        </div>
        <button className="chip-btn" onClick={() => setPlaying((p) => !p)} aria-pressed={!playing}>
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <dl className="hero-figures">
        <Figure name="Shares" value={sec.shares} format={(n) => shares(Math.round(n * 100) / 100)} />
        <Figure name="ACB total" value={sec.acb} format={cad} />
        <Figure name="ACB per share" value={last.acbPerShare} format={cad} />
        <Figure name="Realized" value={sec.realized} format={cad} />
      </dl>
      <div className="hero-table">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Activity</th>
              <th className="num">Shares</th>
              <th className="num">ACB</th>
              <th className="num hide-sm">Per share</th>
              <th className="num">Gain / loss</th>
            </tr>
          </thead>
          <tbody>
            {sec.rows.map((r) => (
              <tr key={r.id} className={r.kind === 'superficial-adj' ? 'row-in wash' : 'row-in'}>
                <td>{r.date.slice(5)}</td>
                <td>{label(r)}</td>
                <td className="num">{shares(r.shares)}</td>
                <td className="num">{cad(r.acb)}</td>
                <td className="num hide-sm">{cad(r.acbPerShare)}</td>
                <td className="num" key={String(r.denied)}>
                  <span className={r.denied ? 'flash' : ''}><Gain v={r.gain} /></span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figcaption className={denied ? 'hero-note on' : 'hero-note'}>
        {denied
          ? `Bought back within 30 days, so ${cad(denied.denied!)} of that April loss is denied and moves into ACB. Only ${cad(-denied.gain!)} is claimable.`
          : 'Each row is computed by the same engine the calculator uses.'}
      </figcaption>
    </figure>
  )
}
