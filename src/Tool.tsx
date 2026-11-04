import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ACCOUNT_TYPES, cad, computeAcb, isRegistered, KIND_LABEL, openLossWindows, TX_KINDS, type AccountType, type Currency, type LedgerRow, type Result, type Security, type Tx, type TxKind } from './engine.ts'
import { ledgerCsv, newId, schedule3Csv, txsToCsv } from './csv.ts'
import { clearCachedRates, fetchRates, FX_SERIES_START, loadCachedRates, lookupFrom, saveRates, uncovered, type Rates } from './fx.ts'
import { SAMPLE_RATES, SAMPLES, WS_ACTIVITIES_CSV, WS_STATEMENT_CSV, YEAR_OF_TRADES } from './samples.ts'
import { AcbChart, GainsChart, WindowTimeline } from './Charts.tsx'
import { CsvDrop, ImportReview } from './Import.tsx'
import Report from './Report.tsx'
import { Brand, download, Footer, Gain, LockIcon, Modal, shares, signed, ThemeToggle } from './ui.tsx'

const TXS_KEY = 'acb.txs.v1'
const VIEWS = [
  ['overview', 'Overview'],
  ['ledger', 'Ledger'],
  ['schedule', 'Schedule 3'],
  ['superficial', 'Superficial losses'],
  ['trades', 'Trades'],
] as const
type View = (typeof VIEWS)[number][0]
type Draft = Partial<Tx> | null

function loadTxs(): Tx[] {
  try {
    const v = JSON.parse(localStorage.getItem(TXS_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
const isSample = (t: Tx) => /^y\d+$/.test(t.id)

export default function Tool() {
  const [txs, setTxs] = useState<Tx[]>(loadTxs)
  const [rates, setRates] = useState<Rates>(loadCachedRates)
  const [fxState, setFxState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [retry, setRetry] = useState(0)
  const [view, setView] = useState<View>('overview')
  const [symbol, setSymbol] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(null)
  const [importing, setImporting] = useState(false)
  const [pending, setPending] = useState<{ text: string; name: string } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmSample, setConfirmSample] = useState(false)
  const [notice, setNotice] = useState('')
  const [storageError, setStorageError] = useState(false)
  const tried = useRef(new Set<string>())

  useEffect(() => {
    document.title = 'Calculator · ACB Tracker'
  }, [])

  useEffect(() => {
    try {
      if (txs.length) localStorage.setItem(TXS_KEY, JSON.stringify(txs))
      else localStorage.removeItem(TXS_KEY)
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }, [txs])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(id)
  }, [notice])

  const loadYearSample = useCallback(() => {
    setRates((r) => {
      const next = { ...SAMPLE_RATES, ...r }
      saveRates(next)
      return next
    })
    setTxs(YEAR_OF_TRADES)
    setView('overview')
    setConfirmSample(false)
    setNotice('Sample year loaded.')
  }, [])

  // /app?sample=year from the landing page. Never overwrites saved trades.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('sample') !== 'year') return
    params.delete('sample')
    history.replaceState(null, '', location.pathname + (params.size ? `?${params}` : ''))
    if (!loadTxs().length) loadYearSample()
  }, [loadYearSample])

  // USD dates we have never asked about. Only that date range goes to the Bank of Canada.
  const usdDates = useMemo(() => [...new Set(txs.filter((t) => t.currency === 'USD' && t.kind !== 'split' && !t.fxRate).map((t) => t.date))], [txs])
  useEffect(() => {
    const need = uncovered(rates, usdDates).filter((d) => !tried.current.has(d))
    if (!need.length) return
    need.forEach((d) => tried.current.add(d))
    setFxState('loading')
    fetchRates(need)
      .then((r) => {
        setRates((prev) => {
          const next = { ...prev, ...r }
          saveRates(next)
          return next
        })
        setFxState('idle')
      })
      .catch(() => setFxState('error'))
  }, [usdDates, rates, retry])

  const result = useMemo(() => computeAcb(txs, lookupFrom(rates)), [txs, rates])
  const accounts = useMemo(() => [...new Map(txs.map((t) => [t.account, t.accountType])).entries()], [txs])
  const current = result.securities.find((s) => s.symbol === symbol) ?? result.securities.find((s) => s.rows.length) ?? result.securities[0]

  const openLedger = (s: string) => {
    setSymbol(s)
    setView('ledger')
    window.scrollTo({ top: 0 })
  }

  const startReview = (text: string, name: string) => {
    setImporting(false)
    setPending({ text, name })
  }
  const pickSample = (id: (typeof SAMPLES)[number]['id']) => {
    if (id === 'year') {
      if (txs.length && !txs.every(isSample)) setConfirmSample(true)
      else loadYearSample()
      return
    }
    setRates((r) => ({ ...SAMPLE_RATES, ...r }))
    if (id === 'activities') startReview(WS_ACTIVITIES_CSV, 'sample-activities-export.csv')
    else startReview(WS_STATEMENT_CSV, 'sample-monthly-statement.csv')
  }
  const finishImport = (fresh: Tx[]) => {
    setTxs((prev) => [...prev.filter((t) => !isSample(t)), ...fresh])
    setPending(null)
    setView('overview')
    setNotice(`Imported ${fresh.length} ${fresh.length === 1 ? 'trade' : 'trades'}.`)
  }
  const saveDraft = (t: Tx) => {
    setTxs((prev) => (prev.some((x) => x.id === t.id) ? prev.map((x) => (x.id === t.id ? t : x)) : [...prev, t]))
    setDraft(null)
    setNotice(`Saved ${KIND_LABEL[t.kind].toLowerCase()} of ${t.symbol}.`)
  }
  const clearAll = () => {
    setTxs([])
    setRates({})
    clearCachedRates()
    tried.current.clear()
    setSymbol(null)
    setConfirmClear(false)
    setView('overview')
    setNotice('All data cleared from this browser.')
  }

  const empty = txs.length === 0
  const sampleMode = !empty && txs.every(isSample)

  return (
    <div className="tool">
      <div className="screen-only">
        <header className="site-head tool-head">
          <Brand />
          <p className="privacy-pill quiet"><LockIcon /> Stored only in this browser</p>
          <div className="site-head-right">
            <ThemeToggle />
            {!empty && <button className="btn small ghost" onClick={() => setDraft({})}>Add trade</button>}
            {!empty && <button className="btn small primary" onClick={() => setImporting(true)}>Import CSV</button>}
          </div>
        </header>

        <p className="sr-only" role="status">{notice}</p>
        {notice && <div className="toast" aria-hidden="true">{notice}</div>}

        <main className="tool-main">
          {storageError && <p className="callout warn" role="alert">This browser refused to save your trades (storage may be full or blocked). They’ll be lost when you close this tab, so export a backup.</p>}
          {empty ? (
            <Empty onText={startReview} onSample={pickSample} onManual={() => setDraft({})} />
          ) : (
            <>
              {sampleMode && (
                <p className="callout sample">
                  <span>You’re looking at sample trades. Importing your own replaces them.</span>
                  <button className="link-btn" onClick={() => setImporting(true)}>Import mine</button>
                </p>
              )}
              <FxNotice state={fxState} result={result} txs={txs} onRetry={() => { tried.current.clear(); setFxState('idle'); setRetry((n) => n + 1) }} />
              <nav className="tabs" aria-label="Sections">
                {VIEWS.map(([id, label]) => (
                  <button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
                    {label}
                    {id === 'superficial' && result.superficial.length > 0 && <span className="count">{result.superficial.length}</span>}
                  </button>
                ))}
              </nav>

              {view === 'overview' && <Overview result={result} onOpen={openLedger} goSuperficial={() => setView('superficial')} />}
              {view === 'ledger' && current && <Ledger sec={current} all={result.securities} onPick={setSymbol} onAdd={(s) => setDraft({ symbol: s, kind: 'roc' })} />}
              {view === 'schedule' && <ScheduleView result={result} />}
              {view === 'superficial' && <SuperficialView result={result} txs={txs} onOpen={openLedger} />}
              {view === 'trades' && <Trades txs={txs} onEdit={setDraft} onDelete={(id) => setTxs((p) => p.filter((t) => t.id !== id))} onAdd={() => setDraft({})} />}

              <section className="actions" aria-label="Export and data">
                <div>
                  <h2>Take it with you</h2>
                  <div className="action-row">
                    <button className="btn small ghost" onClick={() => download('acb-ledger.csv', ledgerCsv(result))}>Ledger CSV</button>
                    <button className="btn small ghost" onClick={() => download('schedule-3.csv', schedule3Csv(result))}>Schedule 3 CSV</button>
                    <button className="btn small ghost" onClick={() => download('acb-trades-backup.csv', txsToCsv(txs))}>Trades backup CSV</button>
                    <button className="btn small ghost" onClick={() => window.print()}>Print report</button>
                  </div>
                </div>
                <div>
                  <h2>Your data</h2>
                  <p className="dim">{txs.length} trades saved in this browser’s local storage, and nowhere else.</p>
                  <button className="btn small danger" onClick={() => setConfirmClear(true)}>Clear all data</button>
                </div>
              </section>
            </>
          )}
        </main>
        <Footer />
      </div>

      {!empty && <Report result={result} />}

      {importing && (
        <Modal title="Import trades" onClose={() => setImporting(false)}>
          <CsvDrop onText={startReview} compact />
        </Modal>
      )}
      {pending && (
        <Modal title="Review import" wide onClose={() => setPending(null)}>
          <ImportReview text={pending.text} name={pending.name} existing={txs.filter((t) => !isSample(t))} onImport={finishImport} onCancel={() => setPending(null)} />
        </Modal>
      )}
      {draft && <TxForm draft={draft} accounts={accounts} onSave={saveDraft} onClose={() => setDraft(null)} />}
      {confirmClear && (
        <Modal title="Clear all data?" onClose={() => setConfirmClear(false)}>
          <p>This deletes all {txs.length} trades and cached exchange rates from this browser. There’s no other copy, so export a backup first if you want one.</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setConfirmClear(false)}>Keep my data</button>
            <button className="btn danger" onClick={clearAll}>Delete everything</button>
          </div>
        </Modal>
      )}
      {confirmSample && (
        <Modal title="Replace your trades?" onClose={() => setConfirmSample(false)}>
          <p>Loading the sample replaces your {txs.length} saved trades. Export a backup first if you want to keep them.</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setConfirmSample(false)}>Cancel</button>
            <button className="btn danger" onClick={loadYearSample}>Replace with sample</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Empty({ onText, onSample, onManual }: { onText: (t: string, n: string) => void; onSample: (id: (typeof SAMPLES)[number]['id']) => void; onManual: () => void }) {
  return (
    <div className="empty">
      <div className="empty-head">
        <h1 className="display">Start with your own trades.</h1>
        <p className="lede">Everything happens in this tab. Your file is read by your browser, saved in its local storage, and never sent anywhere.</p>
      </div>
      <div className="empty-grid">
        <div className="empty-main">
          <CsvDrop onText={onText} />
          <button className="btn ghost" onClick={onManual}>Enter a trade by hand</button>
          <div className="how">
            <h2>Getting your export</h2>
            <ol>
              <li>Sign in to Wealthsimple on the web and open your account activity, or the monthly statements under Documents. Menu names can change.</li>
              <li>Download the CSV for every account, including your TFSA and RRSP. A buyback there can trigger the superficial loss rule.</li>
              <li>Drop the files here one at a time. Overlapping rows are spotted and left out.</li>
            </ol>
          </div>
        </div>
        <aside className="samples" aria-label="Sample data">
          <h2>Or try a sample</h2>
          {SAMPLES.map((s, i) => (
            <button key={s.id} className={`sample-card wash-${['peach', 'lilac', 'butter'][i]}`} onClick={() => onSample(s.id)}>
              <b>{s.title}</b>
              <span>{s.blurb}</span>
            </button>
          ))}
        </aside>
      </div>
    </div>
  )
}

function FxNotice({ state, result, txs, onRetry }: { state: string; result: Result; txs: Tx[]; onRetry: () => void }) {
  if (state === 'loading') return <p className="callout" role="status"><span className="spinner" aria-hidden="true" /> Getting USD/CAD rates from the Bank of Canada…</p>
  const missing = result.missingFx
  if (!missing.length) return null
  const old = missing.filter((d) => d < FX_SERIES_START).length
  const dates = new Set(missing)
  const count = txs.filter((t) => t.currency === 'USD' && dates.has(t.date)).length
  return (
    <p className="callout warn" role="alert">
      <span>
        <b>{count} USD {count === 1 ? 'trade has' : 'trades have'} no exchange rate and {count === 1 ? 'is' : 'are'} counted at 1.0, so the numbers below are wrong until that’s fixed.</b>{' '}
        {old > 0 ? 'The Bank of Canada series starts in 2017, so edit older trades on the Trades tab and enter a rate by hand.' : state === 'error' ? 'We couldn’t reach the Bank of Canada.' : 'A rate may not be published yet.'}
      </span>
      {state === 'error' && <button className="link-btn" onClick={onRetry}>Try again</button>}
    </p>
  )
}

function Tile({ name, value, hint }: { name: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <dt>{name}</dt>
      <dd>{value}</dd>
      {hint && <p className="dim">{hint}</p>}
    </div>
  )
}

function Overview({ result, onOpen, goSuperficial }: { result: Result; onOpen: (s: string) => void; goSuperficial: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const windows = openLossWindows(result, today)
  const latest = result.years[result.years.length - 1]
  const held = result.securities.reduce((a, s) => a + s.acb, 0)
  const denied = result.years.reduce((a, y) => a + y.denied, 0)

  return (
    <div className="view">
      <dl className="tiles">
        <Tile name={latest ? `Net capital gains, ${latest.year}` : 'Net capital gains'} value={latest ? signed(latest.net) : '$0.00'} hint={latest ? undefined : 'No sales yet'} />
        <Tile name={latest ? `Taxable at 50%, ${latest.year}` : 'Taxable at 50%'} value={cad(latest?.taxable ?? 0)} />
        <Tile name="Denied as superficial, all years" value={cad(denied)} />
        <Tile name="ACB of shares held" value={cad(held)} />
      </dl>

      {windows.map((w) => (
        <p className="callout warn" key={w.symbol + w.date}>
          <span><b>{w.symbol} loss window open until {w.until}.</b> You sold {shares(w.quantity)} shares at a {cad(w.loss)} loss on {w.date}. Buying back by then, even in a TFSA or RRSP, can deny it.</span>
        </p>
      ))}
      {result.superficial.length > 0 && (
        <p className="callout lilac">
          <span>{result.superficial.length} {result.superficial.length === 1 ? 'sale was' : 'sales were'} caught by the superficial loss rule, moving {cad(denied)} out of your claimable losses.</span>
          <button className="link-btn" onClick={goSuperficial}>See why</button>
        </p>
      )}
      {result.warnings.length > 0 && (
        <details className="warnings">
          <summary>{result.warnings.length} {result.warnings.length === 1 ? 'warning' : 'warnings'} to check</summary>
          <ul>{result.warnings.map((w, i) => <li key={i}><b>{w.symbol}</b> {w.date}: {w.text}</li>)}</ul>
        </details>
      )}

      <div className="panel">
        <h2>Holdings</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Holdings">
          <table className="data">
            <thead><tr><th>Security</th><th className="num">Shares</th><th className="num">ACB total</th><th className="num">ACB / share</th><th className="num">Realized</th><th>Registered (no ACB)</th></tr></thead>
            <tbody>
              {result.securities.map((s) => (
                <tr key={s.symbol}>
                  <td><button className="link-btn strong" onClick={() => onOpen(s.symbol)}>{s.symbol}</button> <span className="dim name">{s.name !== s.symbol ? s.name : ''}</span></td>
                  <td className="num">{shares(s.shares)}</td>
                  <td className="num">{cad(s.acb)}</td>
                  <td className="num">{s.shares > 0 ? cad(s.acb / s.shares) : '–'}</td>
                  <td className="num"><Gain v={s.realized} /></td>
                  <td>{s.registered.length ? s.registered.map((h) => <span className="tag" key={h.account}>{shares(h.shares)} in {h.account}</span>) : <span className="dim">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {result.years.length > 0 && (
        <div className="panel">
          <h2>Realized gains by tax year</h2>
          <GainsChart years={result.years} />
        </div>
      )}
    </div>
  )
}

const rowLabel = (r: LedgerRow) => (r.kind === 'superficial-adj' ? 'Denied loss added to ACB' : KIND_LABEL[r.kind])

function Ledger({ sec, all, onPick, onAdd }: { sec: Security; all: Security[]; onPick: (s: string) => void; onAdd: (s: string) => void }) {
  return (
    <div className="view">
      <div className="pills" role="group" aria-label="Security">
        {all.map((s) => <button key={s.symbol} aria-pressed={s.symbol === sec.symbol} onClick={() => onPick(s.symbol)}>{s.symbol}</button>)}
      </div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2 className="display small">{sec.symbol}</h2>
            <p className="dim">{sec.name !== sec.symbol ? sec.name : 'All non-registered accounts, pooled'}</p>
          </div>
          <dl className="mini">
            <div><dt>Shares</dt><dd>{shares(sec.shares)}</dd></div>
            <div><dt>ACB</dt><dd>{cad(sec.acb)}</dd></div>
            <div><dt>Per share</dt><dd>{sec.shares > 0 ? cad(sec.acb / sec.shares) : '–'}</dd></div>
            <div><dt>Realized</dt><dd><Gain v={sec.realized} /></dd></div>
          </dl>
        </div>
        {sec.rows.length > 0 ? <AcbChart sec={sec} /> : <p className="dim">Held only in registered accounts, so there’s no ACB to track.</p>}
        {sec.rows.length > 0 && <p className="dim chart-note">Prices are your own trades, in CAD and restated for splits. There’s no market data feed, so nothing about your holdings leaves this browser.</p>}
        {sec.registered.length > 0 && <p className="dim">Also held, outside ACB: {sec.registered.map((h) => `${shares(h.shares)} in ${h.account}${h.account === h.accountType ? '' : ` (${h.accountType})`}`).join(', ')}.</p>}
      </div>

      {sec.rows.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Every change, in order</h2>
            <button className="btn small ghost" onClick={() => onAdd(sec.symbol)}>Add ROC or distribution</button>
          </div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={`${sec.symbol} ledger`}>
            <table className="data ledger">
              <thead>
                <tr><th>Date</th><th>Activity</th><th>Account</th><th className="num">Qty</th><th className="num">Price (CAD)</th><th className="num">FX</th><th className="num">ACB change</th><th className="num">Shares</th><th className="num">ACB total</th><th className="num">ACB / share</th><th className="num">Gain / loss</th></tr>
              </thead>
              {sec.rows.map((r) => (
                <tbody key={r.id} className={r.kind === 'superficial-adj' ? 'wash' : ''}>
                  <tr>
                    <td>{r.date}</td>
                    <td>{rowLabel(r)}</td>
                    <td className="dim">{r.account}</td>
                    <td className="num">{r.quantity ? shares(r.quantity) : r.kind === 'split' ? `×${shares(r.tx.ratio)}` : '–'}</td>
                    <td className="num">{r.priceCad != null ? cad(r.priceCad) : '–'}</td>
                    <td className="num" title={r.fxDate && r.fxDate !== r.date ? `Bank of Canada rate from ${r.fxDate}, the prior business day` : undefined}>
                      {r.fxSource === 'CAD' ? '–' : r.fxSource === 'missing' ? <span className="neg">none</span> : `${r.fx.toFixed(4)}${r.fxSource === 'manual' ? ' manual' : r.fxDate !== r.date ? '*' : ''}`}
                    </td>
                    <td className="num">{r.acbDelta ? signed(r.acbDelta) : '–'}</td>
                    <td className="num">{shares(r.shares)}</td>
                    <td className="num">{cad(r.acb)}</td>
                    <td className="num">{r.shares > 0 ? cad(r.acbPerShare) : '–'}</td>
                    <td className="num"><Gain v={r.gain} />{r.denied ? <div className="dim small">{cad(r.denied)} denied</div> : null}</td>
                  </tr>
                  {r.kind === 'sell' && r.explanation && <tr className="note"><td colSpan={11}>{r.explanation}</td></tr>}
                  {r.warnings.map((w) => <tr className="note warn" key={w}><td colSpan={11}>{w}</td></tr>)}
                </tbody>
              ))}
            </table>
          </div>
          <p className="dim chart-note">* Rate from the prior business day, because the Bank of Canada publishes none on weekends and holidays.</p>
        </div>
      )}
    </div>
  )
}

function ScheduleView({ result }: { result: Result }) {
  const [picked, setPicked] = useState<number | null>(null)
  const years = result.years
  const y = years.find((x) => x.year === picked) ?? years[years.length - 1]
  if (!y) return <div className="view"><div className="panel blank"><h2 className="display small">Nothing to report yet.</h2><p className="dim">Schedule 3 fills in once you’ve sold something, or return of capital pushes ACB below zero.</p></div></div>
  return (
    <div className="view">
      <div className="pills" role="group" aria-label="Tax year">
        {years.map((x) => <button key={x.year} aria-pressed={x.year === y.year} onClick={() => setPicked(x.year)}>{x.year}</button>)}
      </div>
      <dl className="tiles">
        <Tile name="Proceeds" value={cad(y.proceeds)} />
        <Tile name="ACB + outlays" value={cad(y.acb + y.outlays)} />
        <Tile name="Net gain or loss" value={signed(y.net)} hint={`${cad(y.gains)} gains, ${cad(y.losses)} losses`} />
        <Tile name="Taxable at 50%" value={cad(y.taxable)} hint="T1 line 12700" />
      </dl>
      {y.net < 0 && <p className="callout lilac">A net capital loss of {cad(-y.net)} isn’t deductible against other income. It can be carried back 3 years or forward indefinitely against capital gains (Form T1A to carry back).</p>}
      <div className="panel">
        <h2>Publicly traded shares and fund units, {y.year}</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={`Schedule 3 for ${y.year}`}>
          <table className="data">
            <thead><tr><th>Security</th><th>Trade date</th><th>Settled</th><th className="num">Qty</th><th className="num">Proceeds</th><th className="num">ACB</th><th className="num">Outlays</th><th className="num">Gain / loss</th><th className="num">Denied</th></tr></thead>
            <tbody>
              {y.lines.map((l, i) => (
                <tr key={i}>
                  <td><b>{l.symbol}</b> <span className="dim name">{l.kind === 'deemed' ? 'Deemed gain, negative ACB' : l.name !== l.symbol ? l.name : ''}</span></td>
                  <td>{l.date}</td><td>{l.settlement}</td><td className="num">{l.quantity ? shares(l.quantity) : '–'}</td>
                  <td className="num">{cad(l.proceeds)}</td><td className="num">{cad(l.acb)}</td><td className="num">{cad(l.outlays)}</td><td className="num"><Gain v={l.gain} /></td><td className="num">{l.denied ? cad(l.denied) : '–'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={4}>Total</td><td className="num">{cad(y.proceeds)}</td><td className="num">{cad(y.acb)}</td><td className="num">{cad(y.outlays)}</td><td className="num"><Gain v={y.net} /></td><td className="num">{y.denied ? cad(y.denied) : '–'}</td></tr>
            </tfoot>
          </table>
        </div>
        <p className="dim chart-note">Sales land in the tax year they settle: T+1 from May 27, 2024, T+2 before. So a sale on Dec 31 usually belongs to next year. Denied amounts are already netted out of gain or loss. Only the allowed part goes on Schedule 3.</p>
      </div>
    </div>
  )
}

function SuperficialView({ result, txs, onOpen }: { result: Result; txs: Tx[]; onOpen: (s: string) => void }) {
  if (!result.superficial.length)
    return (
      <div className="view">
        <div className="panel blank">
          <h2 className="display small">No superficial losses.</h2>
          <p className="dim">None of your losing sales had shares of the same security bought within 30 days either side and still held on day 30.</p>
        </div>
      </div>
    )
  return (
    <div className="view">
      {result.superficial.map((e) => (
        <article className="panel sl" key={e.saleId}>
          <div className="panel-head">
            <div>
              <h2 className="display small">{e.symbol}, sold {e.date}</h2>
              <p className="dim">{cad(e.loss)} loss, {cad(e.loss - e.denied)} still claimable</p>
            </div>
            <button className="link-btn" onClick={() => onOpen(e.symbol)}>Open ledger</button>
          </div>
          <WindowTimeline ev={e} txs={txs} />
          <div className="formula" aria-label="Denied loss formula">
            <div><dt>Sold (S)</dt><dd>{shares(e.sold)}</dd></div>
            <div><dt>Acquired in window (P)</dt><dd>{shares(e.acquired)}</dd></div>
            <div><dt>Held on day 30 (B)</dt><dd>{shares(e.heldAtEnd)}</dd></div>
            <div><dt>min(S, P, B) ÷ S</dt><dd>{shares(e.substituted)} ÷ {shares(e.sold)}</dd></div>
            <div className="hl"><dt>Denied</dt><dd>{cad(e.denied)}</dd></div>
            <div><dt>Added to ACB</dt><dd>{cad(e.deniedToAcb)}</dd></div>
            {e.deniedLost > 0.005 && <div className="lost"><dt>Lost permanently</dt><dd>{cad(e.deniedLost)}</dd></div>}
          </div>
          <p>{e.explanation}</p>
        </article>
      ))}
    </div>
  )
}

function Trades({ txs, onEdit, onDelete, onAdd }: { txs: Tx[]; onEdit: (t: Tx) => void; onDelete: (id: string) => void; onAdd: () => void }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return [...txs].filter((t) => !s || `${t.symbol} ${t.account} ${t.kind} ${t.date}`.toLowerCase().includes(s)).sort((a, b) => b.date.localeCompare(a.date))
  }, [txs, q])
  return (
    <div className="view">
      <div className="panel">
        <div className="panel-head">
          <h2>All {txs.length} trades</h2>
          <div className="action-row">
            <input type="search" placeholder="Filter by symbol, account, date" aria-label="Filter trades" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn small ghost" onClick={onAdd}>Add trade</button>
          </div>
        </div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Trades">
          <table className="data">
            <thead><tr><th>Date</th><th>Symbol</th><th>Activity</th><th>Account</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Fee</th><th className="num">Amount</th><th>Ccy</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td><b>{t.symbol}</b></td>
                  <td>{KIND_LABEL[t.kind]}{t.kind === 'split' ? ` ×${t.ratio}` : ''}</td>
                  <td>{t.account} {isRegistered(t.accountType) && <span className="tag">{t.accountType}</span>}</td>
                  <td className="num">{t.quantity ? shares(t.quantity) : '–'}</td>
                  <td className="num">{t.price ? cad(t.price) : '–'}</td>
                  <td className="num">{t.commission ? cad(t.commission) : '–'}</td>
                  <td className="num">{t.amount ? cad(t.amount) : '–'}</td>
                  <td>{t.currency}</td>
                  <td className="row-actions">
                    <button className="link-btn" onClick={() => onEdit(t)} aria-label={`Edit ${t.symbol} ${t.date}`}>Edit</button>
                    <button className="link-btn" onClick={() => onDelete(t.id)} aria-label={`Delete ${t.symbol} ${t.date}`}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <p className="dim table-more">No trades match that filter.</p>}
        </div>
      </div>
    </div>
  )
}

function TxForm({ draft, accounts, onSave, onClose }: { draft: Partial<Tx>; accounts: [string, AccountType][]; onSave: (t: Tx) => void; onClose: () => void }) {
  const [kind, setKind] = useState<TxKind>(draft.kind ?? 'buy')
  const [date, setDate] = useState(draft.date ?? '')
  const [symbol, setSymbol] = useState(draft.symbol ?? '')
  const [account, setAccount] = useState(draft.account ?? accounts[0]?.[0] ?? 'Personal')
  const [accountType, setAccountType] = useState<AccountType>(draft.accountType ?? accounts[0]?.[1] ?? 'Non-registered')
  const [currency, setCurrency] = useState<Currency>(draft.currency ?? 'CAD')
  const num = (v: number | undefined) => (v ? String(v) : '')
  const [quantity, setQuantity] = useState(num(draft.quantity))
  const [price, setPrice] = useState(num(draft.price))
  const [commission, setCommission] = useState(num(draft.commission))
  const [amount, setAmount] = useState(num(draft.amount))
  const [ratio, setRatio] = useState(draft.kind === 'split' ? num(draft.ratio) : '')
  const [fxRate, setFxRate] = useState(num(draft.fxRate))
  const [note, setNote] = useState(draft.note ?? '')
  const [error, setError] = useState('')
  const trade = kind === 'buy' || kind === 'sell'
  const cash = kind === 'roc' || kind === 'reinvest'

  const submit = () => {
    const sym = symbol.trim().toUpperCase()
    if (!date) return setError('Enter the trade date.')
    if (!sym) return setError('Enter a symbol.')
    if (trade && !(+quantity > 0)) return setError('Quantity must be more than zero.')
    if (trade && !(+price >= 0 && price !== '')) return setError('Enter the price per share.')
    if (cash && !(+amount > 0)) return setError('Enter the total amount from your slip.')
    if (kind === 'split' && !(+ratio > 0)) return setError('Enter the split ratio: new shares for each old share.')
    onSave({
      id: draft.id ?? newId(),
      date,
      account: account.trim() || 'Personal',
      accountType,
      symbol: sym,
      name: draft.name,
      kind,
      quantity: trade ? +quantity : 0,
      price: trade ? +price : 0,
      commission: trade ? +commission || 0 : 0,
      amount: cash ? +amount : 0,
      ratio: kind === 'split' ? +ratio : 1,
      currency,
      fxRate: currency === 'USD' && +fxRate > 0 ? +fxRate : undefined,
      note: note.trim() || undefined,
    })
  }

  return (
    <Modal title={draft.id ? 'Edit trade' : 'Add a trade'} onClose={onClose}>
      <form className="tx-form" onSubmit={(e) => { e.preventDefault(); submit() }} noValidate>
        <label className="span2">
          <span>Activity</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as TxKind)}>
            {TX_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label><span>Trade date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label><span>Symbol</span><input value={symbol} onChange={(e) => setSymbol(e.target.value)} autoCapitalize="characters" placeholder="XEQT" /></label>
        <label>
          <span>Account</span>
          <input
            list="acct-names"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value)
              const known = accounts.find(([a]) => a === e.target.value)
              if (known) setAccountType(known[1])
            }}
          />
          <datalist id="acct-names">{accounts.map(([a]) => <option key={a} value={a} />)}</datalist>
        </label>
        <label>
          <span>Account type</span>
          <select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        {trade && <label><span>Quantity</span><input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>}
        {trade && <label><span>Price per share</span><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>}
        {trade && <label><span>Commission</span><input inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="0" /></label>}
        {cash && <label className="span2"><span>{kind === 'roc' ? 'Return of capital (T3 box 42)' : 'Reinvested distribution (usually T3 box 21)'}</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
        {kind === 'split' && <label className="span2"><span>New shares per old share (4 for a 4-for-1, 0.1 for a 1-for-10)</span><input inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} /></label>}
        {kind !== 'split' && (
          <label>
            <span>Currency</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              <option>CAD</option>
              <option>USD</option>
            </select>
          </label>
        )}
        {kind !== 'split' && currency === 'USD' && <label><span>Manual FX rate (optional)</span><input inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="Bank of Canada" /></label>}
        <label className="span2"><span>Note</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {error && <p className="field-error span2" role="alert">{error}</p>}
        <div className="modal-actions span2">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </Modal>
  )
}
