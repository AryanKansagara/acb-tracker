// CSV import/export. Understands Wealthsimple's Activities export (English and French headers),
// the monthly statement CSV, this app's own template, and anything else via a column mapping.
import { ACCOUNT_TYPES, KIND_LABEL, type AccountType, type Currency, type Result, type Tx, type TxKind, TX_KINDS } from './engine.ts'

/** RFC 4180 parser: quoted fields, escaped quotes, CRLF, BOM, ; or , delimiter. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const first = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === delim) row.push(field), (field = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.some((f) => f.trim()))
}

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(esc).join(',')).join('\n') + '\n'

// ---------- mapping ----------
export const FIELDS = ['date', 'symbol', 'type', 'quantity', 'price', 'commission', 'amount', 'ratio', 'currency', 'fx_rate', 'account', 'account_type', 'name', 'net_amount', 'note', 'activity'] as const
export type Field = (typeof FIELDS)[number]
export type Mapping = Partial<Record<Field, number>>
export const REQUIRED: Field[] = ['date', 'symbol', 'type', 'quantity']

const ALIASES: Record<Field, string[]> = {
  date: ['date', 'transaction_date', 'trade_date', 'date_effet', 'effective_date', 'trade date', 'transaction date', 'settlement_date'],
  symbol: ['symbol', 'symbole', 'ticker', 'security'],
  type: ['type', 'activity_sub_type', 'sous_type_activite', 'action', 'transaction', 'transaction_type', 'side'],
  quantity: ['quantity', 'quantite', 'shares', 'units', 'qty'],
  price: ['price', 'unit_price', 'prix_unitaire', 'price_per_share', 'share price'],
  commission: ['commission', 'fees', 'fee', 'commissions'],
  amount: ['amount'],
  ratio: ['ratio', 'split_ratio'],
  currency: ['currency', 'devise', 'ccy', 'cur'],
  fx_rate: ['fx_rate', 'fx', 'exchange_rate'],
  account: ['account', 'account_id', 'compte_id', 'account_name', 'account number'],
  account_type: ['account_type', 'type_compte', 'account type'],
  name: ['name', 'nom', 'security_name', 'description'],
  net_amount: ['net_cash_amount', 'montant_net_especes', 'net_amount', 'total'],
  note: ['note', 'notes', 'memo'],
  activity: ['activity_type', 'type_activite'],
}

const norm = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase()

export function autoMap(headers: string[]): Mapping {
  const m: Mapping = {}
  const hs = headers.map(norm)
  for (const f of FIELDS) {
    for (const a of ALIASES[f]) {
      const i = hs.indexOf(a)
      if (i >= 0 && !Object.values(m).includes(i)) {
        m[f] = i
        break
      }
    }
  }
  return m
}

export type Format = 'ws-activities' | 'ws-statement' | 'template' | 'unknown'

export function detectFormat(headers: string[]): Format {
  const hs = headers.map(norm)
  const has = (...k: string[]) => k.every((x) => hs.includes(x))
  if ((has('activity_type', 'activity_sub_type') || has('type_activite', 'sous_type_activite')) && (hs.includes('symbol') || hs.includes('symbole'))) return 'ws-activities'
  if (has('date', 'transaction', 'description', 'amount', 'balance')) return 'ws-statement'
  if (has('date', 'symbol', 'type', 'quantity', 'price')) return 'template'
  return 'unknown'
}

export function normKind(raw: string): TxKind | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if ((TX_KINDS as readonly string[]).includes(s)) return s as TxKind
  if (/^(buy|bought|purchase|achat|drip|reinvest(ed)?_?dividend|reinvestment|b)$/.test(s) || s.startsWith('buy')) return 'buy'
  if (/^(sell|sold|sale|vente|s)$/.test(s) || s.startsWith('sell')) return 'sell'
  if (/return.?of.?capital|^roc$/.test(s)) return 'roc'
  if (/split|consolidat/.test(s)) return 'split'
  if (/phantom|notional|reinvested.?distribution|reinvested capital gain/.test(s)) return 'reinvest'
  return null
}

export function normAccountType(raw: string): AccountType {
  const s = raw.trim().toLowerCase()
  if (/tfsa|celi(?!app)/.test(s)) return 'TFSA'
  if (/fhsa|celiapp/.test(s)) return 'FHSA'
  if (/rrif|ferr/.test(s)) return 'RRIF'
  if (/lira|cri/.test(s)) return 'LIRA'
  if (/rrsp|reer|rsp/.test(s)) return 'RRSP'
  if (/resp|reee/.test(s)) return 'RESP'
  const exact = ACCOUNT_TYPES.find((t) => t.toLowerCase() === s)
  return exact ?? 'Non-registered'
}

export function parseNum(raw: string | undefined): number {
  if (raw == null) return NaN
  let s = raw.trim().replace(/[$\s ]|CAD|USD/gi, '')
  if (!s) return NaN
  const neg = /^\(.*\)$/.test(s)
  s = s.replace(/[()]/g, '')
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.234,56
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.') // 12,5 (French)
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return neg ? -n : n
}

export function parseDate(raw: string): string | null {
  const s = raw.trim()
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
  // Slashed dates only when unambiguous; 03/04/2025 could be either and must not be guessed in a tax tool.
  const sl = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (sl) {
    const [a, b] = [+sl[1], +sl[2]]
    if (a > 12 && b <= 12) return `${sl[3]}-${sl[2].padStart(2, '0')}-${sl[1].padStart(2, '0')}`
    if (b > 12 && a <= 12) return `${sl[3]}-${sl[1].padStart(2, '0')}-${sl[2].padStart(2, '0')}`
    return null
  }
  const t = Date.parse(s)
  if (!Number.isNaN(t) && /[a-z]/i.test(s)) {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return null
}

export interface ImportOptions {
  defaultAccount: string
  defaultAccountType: AccountType
  defaultCurrency: Currency
}

export interface ImportResult {
  txs: Tx[]
  skipped: { line: number; reason: string }[]
}

let seq = 0
export const newId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function importRows(rows: string[][], mapping: Mapping, opts: ImportOptions): ImportResult {
  const txs: Tx[] = []
  const skipped: ImportResult['skipped'] = []
  const get = (r: string[], f: Field) => (mapping[f] != null ? (r[mapping[f]!] ?? '').trim() : '')
  rows.slice(1).forEach((r, i) => {
    const line = i + 2
    const date = parseDate(get(r, 'date'))
    // Wealthsimple: direction lives in activity_sub_type, but some events only fill activity_type.
    let kind = normKind(get(r, 'type')) ?? normKind(get(r, 'activity'))
    let quantity = parseNum(get(r, 'quantity'))
    if (kind === 'reinvest' && Math.abs(quantity) > 0) kind = 'buy' // a DRIP that delivered shares is a purchase
    if (!kind && mapping.type == null && quantity) kind = quantity > 0 ? 'buy' : 'sell'
    const symbol = get(r, 'symbol').toUpperCase()
    if (!kind) return skipped.push({ line, reason: `not a trade (${get(r, 'type') || 'no type'})` })
    if (!date) return skipped.push({ line, reason: `unreadable date "${get(r, 'date')}"` })
    if (!symbol) return skipped.push({ line, reason: 'no symbol' })
    quantity = Math.abs(quantity || 0)
    let price = Math.abs(parseNum(get(r, 'price')))
    const net = Math.abs(parseNum(get(r, 'net_amount')))
    const commission = Math.abs(parseNum(get(r, 'commission'))) || 0
    if (!(price > 0) && net > 0 && quantity > 0) price = (kind === 'buy' ? net - commission : net + commission) / quantity
    let amount = Math.abs(parseNum(get(r, 'amount')))
    if (!(amount > 0) && (kind === 'roc' || kind === 'reinvest')) amount = net || 0
    const ratio = parseNum(get(r, 'ratio'))
    if ((kind === 'buy' || kind === 'sell') && !(quantity > 0)) return skipped.push({ line, reason: 'no quantity' })
    if ((kind === 'buy' || kind === 'sell') && !(price >= 0)) return skipped.push({ line, reason: 'no price' })
    if (kind === 'split' && !(ratio > 0)) return skipped.push({ line, reason: 'split without ratio' })
    const cur = get(r, 'currency').toUpperCase()
    const fx = parseNum(get(r, 'fx_rate'))
    const accountType = get(r, 'account_type') ? normAccountType(get(r, 'account_type')) : opts.defaultAccountType
    const name = get(r, 'name').replace(/^[A-Z0-9.\-]+ - /, '').replace(/:.*$/, '') || undefined
    txs.push({
      id: newId(),
      date,
      account: get(r, 'account') || (get(r, 'account_type') ? `${accountType}` : opts.defaultAccount),
      accountType,
      symbol,
      name: name && name.length < 60 ? name : undefined,
      kind,
      quantity,
      price: price || 0,
      commission,
      amount: amount || 0,
      ratio: ratio > 0 ? ratio : 1,
      currency: cur === 'USD' ? 'USD' : cur === 'CAD' ? 'CAD' : opts.defaultCurrency,
      fxRate: fx > 0 ? fx : undefined,
      note: get(r, 'note') || undefined,
    })
  })
  return { txs, skipped }
}

// Monthly statement lines look like:
// "AAPL - Apple Inc.: Bought 10.0000 shares (executed at 2024-01-15), FX Rate: 1.3456"
const STATEMENT_RE = /^\s*([A-Z0-9.\-]+)\s*-\s*(.+?):\s*(Bought|Sold)\s+([\d.,]+)\s+shares?(?:\s*\(executed at (\d{4}-\d{2}-\d{2})\))?/i

export function importStatement(rows: string[][], opts: ImportOptions): ImportResult {
  const h = rows[0].map(norm)
  const col = (k: string) => h.indexOf(k)
  const [cDate, cType, cDesc, cAmt, cCur] = [col('date'), col('transaction'), col('description'), col('amount'), col('currency')]
  const txs: Tx[] = []
  const skipped: ImportResult['skipped'] = []
  rows.slice(1).forEach((r, i) => {
    const line = i + 2
    const type = (r[cType] ?? '').trim().toUpperCase()
    if (type !== 'BUY' && type !== 'SELL') return skipped.push({ line, reason: `not a trade (${type || 'blank'})` })
    const m = (r[cDesc] ?? '').match(STATEMENT_RE)
    if (!m) return skipped.push({ line, reason: 'unrecognized description' })
    const quantity = parseNum(m[4])
    const total = Math.abs(parseNum(r[cAmt]))
    const date = m[5] ?? parseDate(r[cDate] ?? '')
    if (!date || !(quantity > 0) || !(total >= 0)) return skipped.push({ line, reason: 'missing date, quantity or amount' })
    const cur = cCur >= 0 ? (r[cCur] ?? '').trim().toUpperCase() : ''
    txs.push({
      id: newId(),
      date,
      account: opts.defaultAccount,
      accountType: opts.defaultAccountType,
      symbol: m[1].toUpperCase(),
      name: m[2].trim(),
      kind: type === 'BUY' ? 'buy' : 'sell',
      quantity,
      price: total / quantity, // statement amounts are net; Wealthsimple charges no commission on stock trades
      commission: 0,
      amount: 0,
      ratio: 1,
      currency: cur === 'USD' ? 'USD' : cur === 'CAD' ? 'CAD' : opts.defaultCurrency,
    })
  })
  return { txs, skipped }
}

export const TEMPLATE_HEADERS = ['date', 'account', 'account_type', 'symbol', 'name', 'type', 'quantity', 'price', 'commission', 'amount', 'ratio', 'currency', 'fx_rate', 'note']

export function txsToCsv(txs: Tx[]): string {
  return toCsv([
    TEMPLATE_HEADERS,
    ...txs.map((t) => [t.date, t.account, t.accountType, t.symbol, t.name ?? '', t.kind, t.quantity || '', t.price || '', t.commission || '', t.amount || '', t.kind === 'split' ? t.ratio : '', t.currency, t.fxRate ?? '', t.note ?? '']),
  ])
}

export const TEMPLATE_EXAMPLE = toCsv([
  TEMPLATE_HEADERS,
  ['2025-01-15', 'Personal', 'Non-registered', 'XEQT', 'iShares Core Equity ETF', 'buy', 100, 31.2, 0, '', '', 'CAD', '', ''],
  ['2025-02-03', 'Personal USD', 'Non-registered', 'AAPL', 'Apple Inc.', 'buy', 10, 228.01, 0, '', '', 'USD', '', 'rate looked up from Bank of Canada'],
  ['2025-06-30', 'Personal', 'Non-registered', 'XEQT', '', 'reinvest', '', '', '', 12.4, '', 'CAD', '', 'reinvested capital gains distribution (T3 box 21)'],
  ['2025-12-31', 'Personal', 'Non-registered', 'REI.UN', 'RioCan REIT', 'roc', '', '', '', 41.85, '', 'CAD', '', 'T3 box 42'],
  ['2025-06-10', 'Personal', 'Non-registered', 'NVDA', '', 'split', '', '', '', '', 10, 'USD', '', '10-for-1'],
  ['2025-09-02', 'Personal', 'Non-registered', 'XEQT', '', 'sell', 40, 35.1, 4.95, '', '', 'CAD', '', ''],
])

const m2 = (n: number | undefined) => (n === undefined ? '' : n.toFixed(2))

export function ledgerCsv(r: Result): string {
  const rows: unknown[][] = [['symbol', 'date', 'account', 'activity', 'quantity', 'price_cad', 'fx_rate', 'fx_source', 'acb_change', 'shares', 'acb_total', 'acb_per_share', 'proceeds', 'outlays', 'acb_of_sold', 'gain_loss', 'denied_superficial', 'tax_year', 'warnings']]
  for (const s of r.securities)
    for (const x of s.rows)
      rows.push([s.symbol, x.date, x.account, x.kind === 'superficial-adj' ? 'Denied loss added to ACB' : KIND_LABEL[x.kind], x.quantity || '', m2(x.priceCad), x.fx, x.fxSource, m2(x.acbDelta), +x.shares.toFixed(6), m2(x.acb), x.acbPerShare.toFixed(4), m2(x.proceeds), m2(x.outlays), m2(x.acbSold), m2(x.gain), x.denied ? m2(x.denied) : '', x.taxYear ?? '', x.warnings.join(' ')])
  return toCsv(rows)
}

export function schedule3Csv(r: Result): string {
  const rows: unknown[][] = [['tax_year', 'symbol', 'description', 'quantity', 'trade_date', 'settlement_date', 'proceeds', 'acb', 'outlays', 'gain_loss', 'denied_superficial', 'type']]
  for (const y of r.years) {
    for (const l of y.lines) rows.push([y.year, l.symbol, l.name, l.quantity || '', l.date, l.settlement, m2(l.proceeds), m2(l.acb), m2(l.outlays), m2(l.gain), m2(l.denied), l.kind])
    rows.push([y.year, 'TOTAL', '', '', '', '', m2(y.proceeds), m2(y.acb), m2(y.outlays), m2(y.net), m2(y.denied), ''])
  }
  return toCsv(rows)
}

/** Same-trade fingerprint: re-importing an overlapping export shouldn't double-count shares. */
export const txKey = (t: Tx) => [t.date, t.account, t.symbol, t.kind, t.quantity, t.price.toFixed(4), t.amount, t.ratio].join('|')
