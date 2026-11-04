import { cad, KIND_LABEL, type Result } from './engine.ts'
import { Disclaimer, shares, signed } from './ui.tsx'

/** Only visible on paper: @media print swaps this in for the whole app. */
export default function Report({ result }: { result: Result }) {
  return (
    <section className="report" aria-hidden="true">
      <h1>ACB Tracker report</h1>
      <p>Generated {new Date().toISOString().slice(0, 10)}. All amounts in CAD. Computed locally in the browser from trades entered by the taxpayer.</p>
      <Disclaimer />

      <h2>Schedule 3 summary</h2>
      {result.years.map((y) => (
        <div key={y.year} className="report-block">
          <h3>Tax year {y.year}</h3>
          <table>
            <thead><tr><th>Security</th><th>Trade date</th><th>Settled</th><th className="num">Qty</th><th className="num">Proceeds</th><th className="num">ACB</th><th className="num">Outlays</th><th className="num">Gain / loss</th><th className="num">Denied</th></tr></thead>
            <tbody>
              {y.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.symbol}{l.kind === 'deemed' ? ' (negative ACB)' : ''}</td><td>{l.date}</td><td>{l.settlement}</td><td className="num">{l.quantity ? shares(l.quantity) : ''}</td>
                  <td className="num">{cad(l.proceeds)}</td><td className="num">{cad(l.acb)}</td><td className="num">{cad(l.outlays)}</td><td className="num">{signed(l.gain)}</td><td className="num">{l.denied ? cad(l.denied) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Total</td><td className="num">{cad(y.proceeds)}</td><td className="num">{cad(y.acb)}</td><td className="num">{cad(y.outlays)}</td><td className="num">{signed(y.net)}</td><td className="num">{cad(y.denied)}</td></tr>
            </tfoot>
          </table>
          <p>Taxable capital gain at 50% inclusion: <b>{cad(y.taxable)}</b>{y.net < 0 ? ` (net capital loss of ${cad(-y.net)} can carry back 3 years or forward indefinitely)` : ''}</p>
        </div>
      ))}

      {result.superficial.length > 0 && (
        <>
          <h2>Superficial losses</h2>
          {result.superficial.map((e) => <p key={e.saleId}><b>{e.symbol}.</b> {e.explanation}</p>)}
        </>
      )}

      <h2>Ledger by security</h2>
      {result.securities.map((s) => (
        <div key={s.symbol} className="report-block">
          <h3>{s.symbol} <small>{s.name !== s.symbol ? s.name : ''}</small></h3>
          {s.rows.length > 0 && (
            <table>
              <thead><tr><th>Date</th><th>Account</th><th>Activity</th><th className="num">Qty</th><th className="num">FX</th><th className="num">ACB change</th><th className="num">Shares</th><th className="num">ACB</th><th className="num">ACB/share</th><th className="num">Gain / loss</th></tr></thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td><td>{r.account}</td><td>{r.kind === 'superficial-adj' ? 'Denied loss added to ACB' : KIND_LABEL[r.kind]}</td><td className="num">{r.quantity ? shares(r.quantity) : ''}</td>
                    <td className="num">{r.fxSource === 'CAD' ? '' : r.fx.toFixed(4)}</td><td className="num">{cad(r.acbDelta)}</td><td className="num">{shares(r.shares)}</td><td className="num">{cad(r.acb)}</td><td className="num">{cad(r.acbPerShare)}</td><td className="num">{r.gain === undefined ? '' : signed(r.gain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.registered.map((h) => <p key={h.account}>Also held in {h.account}{h.account === h.accountType ? '' : ` (${h.accountType})`}: {shares(h.shares)} shares, excluded from ACB.</p>)}
        </div>
      ))}
    </section>
  )
}
