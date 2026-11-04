import { useMemo, useState, type DragEvent } from 'react'
import { ACCOUNT_TYPES, KIND_LABEL, cad, type AccountType, type Currency, type Tx } from './engine.ts'
import { autoMap, detectFormat, FIELDS, importRows, importStatement, parseCsv, TEMPLATE_EXAMPLE, txKey, type Field, type Mapping } from './csv.ts'
import { download, shares } from './ui.tsx'

const FORMAT_LABEL = {
  'ws-activities': 'Wealthsimple Activities export',
  'ws-statement': 'Wealthsimple monthly statement',
  template: 'ACB Tracker template',
  unknown: 'Unrecognized format',
}

const FIELD_LABEL: Record<Field, string> = {
  date: 'Trade date',
  symbol: 'Symbol',
  type: 'Type (buy, sell…)',
  quantity: 'Quantity',
  price: 'Price per share',
  commission: 'Commission',
  amount: 'Amount (ROC, distribution)',
  ratio: 'Split ratio',
  currency: 'Currency',
  fx_rate: 'FX rate',
  account: 'Account',
  account_type: 'Account type',
  name: 'Security name',
  net_amount: 'Net amount',
  note: 'Note',
  activity: 'Activity type',
}

/** Drop, browse or paste: where every import starts. */
export function CsvDrop({ onText, compact }: { onText: (text: string, name: string) => void; compact?: boolean }) {
  const [over, setOver] = useState(false)
  const [paste, setPaste] = useState('')
  const [error, setError] = useState('')

  const read = async (f: File | undefined) => {
    if (!f) return
    setError('')
    try {
      onText(await f.text(), f.name)
    } catch {
      setError(`Couldn't read ${f.name}. Is it a CSV file?`)
    }
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    read(e.dataTransfer.files[0])
  }

  return (
    <div className="drop-wrap">
      <label
        className={`drop ${over ? 'over' : ''} ${compact ? 'compact' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => { read(e.target.files?.[0]); e.target.value = '' }} />
        <span className="drop-title">Drop a CSV, or browse</span>
        <span className="dim">Wealthsimple activity exports, monthly statements, or any CSV with dates and trades. It’s read right here, never uploaded.</span>
      </label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <details className="paste">
        <summary>Paste CSV text instead</summary>
        <textarea rows={5} aria-label="CSV text" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="date,symbol,type,quantity,price…" spellCheck={false} />
        <button className="btn small" disabled={!paste.trim()} onClick={() => onText(paste, 'pasted text')}>Read this CSV</button>
      </details>
      <button className="link-btn" onClick={() => download('acb-tracker-template.csv', TEMPLATE_EXAMPLE)}>Download the CSV template</button>
    </div>
  )
}

/** Detect, map, preview, confirm. Nothing is saved until the user presses import. */
export function ImportReview({ text, name, existing, onImport, onCancel }: { text: string; name: string; existing: Tx[]; onImport: (txs: Tx[]) => void; onCancel: () => void }) {
  const rows = useMemo(() => parseCsv(text), [text])
  const headers = useMemo(() => rows[0] ?? [], [rows])
  const format = useMemo(() => detectFormat(headers), [headers])
  const [mapping, setMapping] = useState<Mapping>(() => autoMap(headers))
  const [account, setAccount] = useState('Personal')
  const [accountType, setAccountType] = useState<AccountType>('Non-registered')
  const [currency, setCurrency] = useState<Currency>('CAD')

  const result = useMemo(() => {
    if (!rows.length) return { txs: [], skipped: [] }
    const opts = { defaultAccount: account, defaultAccountType: accountType, defaultCurrency: currency }
    return format === 'ws-statement' ? importStatement(rows, opts) : importRows(rows, mapping, opts)
  }, [rows, format, mapping, account, accountType, currency])

  // Only rows already saved count as duplicates; two identical fills in one file are two real trades.
  const seen = useMemo(() => new Set(existing.map(txKey)), [existing])
  const fresh = result.txs.filter((t) => !seen.has(txKey(t)))
  const dupes = result.txs.length - fresh.length
  const usesDefaults = format === 'ws-statement' || mapping.account_type == null

  return (
    <div className="review">
      <p className="review-meta">
        <span className={format === 'unknown' ? 'tag warn' : 'tag'}>{FORMAT_LABEL[format]}</span>
        <span className="dim">{name}, {Math.max(rows.length - 1, 0)} rows</span>
      </p>

      {format !== 'ws-statement' && (
        <details className="mapping" open={format === 'unknown'}>
          <summary>{format === 'unknown' ? 'Match your columns' : 'Check column mapping'}</summary>
          {format === 'unknown' && <p className="dim">We didn’t recognize this file. Tell us which column holds what. Date and symbol are required, plus a type column or signed quantities.</p>}
          <div className="map-grid">
            {FIELDS.map((f) => (
              <label key={f}>
                <span>{FIELD_LABEL[f]}</span>
                <select
                  value={mapping[f] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setMapping((m) => {
                      const n = { ...m }
                      if (v === '') delete n[f]
                      else n[f] = +v
                      return n
                    })
                  }}
                >
                  <option value="">Not in this file</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
        </details>
      )}

      {usesDefaults && (
        <fieldset className="defaults">
          <legend>{format === 'ws-statement' ? 'Which account is this statement for?' : 'This file doesn’t say which account'}</legend>
          <label><span>Account name</span><input value={account} onChange={(e) => setAccount(e.target.value)} /></label>
          <label>
            <span>Type</span>
            <select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}>
              {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>
            <span>Default currency</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              <option>CAD</option>
              <option>USD</option>
            </select>
          </label>
        </fieldset>
      )}

      {fresh.length > 0 ? (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Preview of trades to import">
          <table className="data">
            <thead>
              <tr><th>Date</th><th>Symbol</th><th>Activity</th><th>Account</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th><th>Ccy</th></tr>
            </thead>
            <tbody>
              {fresh.slice(0, 8).map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td><td><b>{t.symbol}</b></td><td>{KIND_LABEL[t.kind]}</td><td>{t.account} <span className="dim">{t.accountType}</span></td>
                  <td className="num">{t.quantity ? shares(t.quantity) : '–'}</td><td className="num">{t.price ? cad(t.price) : '–'}</td><td className="num">{t.amount ? cad(t.amount) : '–'}</td><td>{t.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {fresh.length > 8 && <p className="dim table-more">and {fresh.length - 8} more</p>}
        </div>
      ) : (
        <p className="callout warn" role="status">
          {result.txs.length ? 'Every trade in this file is already saved.' : rows.length < 2 ? 'This file has no data rows.' : 'No trades found yet. Check that the date, symbol and type columns are matched.'}
        </p>
      )}

      {dupes > 0 && <p className="dim">{dupes} {dupes === 1 ? 'trade is' : 'trades are'} already saved and will be left out.</p>}
      {result.skipped.length > 0 && (
        <details className="skipped">
          <summary>{result.skipped.length} rows skipped (dividends, deposits and other non-trades don’t affect ACB)</summary>
          <ul>{result.skipped.slice(0, 40).map((s) => <li key={s.line}>Line {s.line}: {s.reason}</li>)}</ul>
        </details>
      )}

      <div className="modal-actions">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!fresh.length} onClick={() => onImport(fresh)}>Import {fresh.length} {fresh.length === 1 ? 'trade' : 'trades'}</button>
      </div>
    </div>
  )
}
