// Adjusted cost base engine, following CRA rules for identical properties:
// one ACB pool per security across all of a person's non-registered accounts,
// superficial loss denial (ITA s.54) and negative ACB deemed gains (s.40(3)).

export const ACCOUNT_TYPES = ['Non-registered', 'TFSA', 'RRSP', 'FHSA', 'RESP', 'RRIF', 'LIRA', 'Other registered'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]
export const isRegistered = (t: AccountType) => t !== 'Non-registered'

export const TX_KINDS = ['buy', 'sell', 'roc', 'reinvest', 'split'] as const
export type TxKind = (typeof TX_KINDS)[number]
export const KIND_LABEL: Record<TxKind, string> = {
  buy: 'Buy',
  sell: 'Sell',
  roc: 'Return of capital',
  reinvest: 'Reinvested distribution',
  split: 'Split / consolidation',
}

export type Currency = 'CAD' | 'USD'

export interface Tx {
  id: string
  date: string // trade date, YYYY-MM-DD
  account: string
  accountType: AccountType
  symbol: string
  name?: string
  kind: TxKind
  quantity: number // shares (buy / sell)
  price: number // per share, in `currency`
  commission: number // in `currency`
  amount: number // total, in `currency` (roc / reinvest)
  ratio: number // split: new shares per old share (4 = 4-for-1, 0.1 = 1-for-10)
  currency: Currency
  fxRate?: number // manual CAD per unit override
  note?: string
}

export type RowKind = TxKind | 'superficial-adj'

export interface LedgerRow {
  id: string
  tx: Tx
  kind: RowKind
  date: string
  account: string
  fx: number
  fxSource: 'CAD' | 'BoC' | 'manual' | 'missing'
  fxDate?: string
  quantity: number
  shares: number
  acbDelta: number
  acb: number
  acbPerShare: number
  priceCad?: number
  proceeds?: number
  outlays?: number
  acbSold?: number
  gain?: number // capital gain (loss) allowed this row, after superficial denial
  denied?: number // loss denied as superficial (positive number)
  taxYear?: number
  warnings: string[]
  explanation?: string
}

export interface SuperficialEvent {
  symbol: string
  saleId: string
  date: string
  windowStart: string
  windowEnd: string
  sold: number
  loss: number // positive
  acquired: number
  acquiredRegistered: number
  heldAtEnd: number
  heldAtEndRegistered: number
  substituted: number
  denied: number
  deniedToAcb: number
  deniedLost: number
  substituteHeld: boolean // non-registered substitute shares were already acquired by the sale date
  explanation: string
}

export interface RegisteredHolding {
  account: string
  accountType: AccountType
  shares: number
  cost: number // CAD, informational only
}

export interface Security {
  symbol: string
  name: string
  currency: Currency
  rows: LedgerRow[]
  shares: number
  acb: number
  realized: number
  registered: RegisteredHolding[]
}

export interface Schedule3Line {
  symbol: string
  name: string
  date: string
  settlement: string
  quantity: number
  proceeds: number
  acb: number
  outlays: number
  gain: number
  denied: number
  kind: 'sale' | 'deemed'
}

export interface TaxYear {
  year: number
  lines: Schedule3Line[]
  proceeds: number
  acb: number
  outlays: number
  gains: number
  losses: number
  net: number
  denied: number
  taxable: number // net capital losses aren't taxable; they carry back 3 years or forward indefinitely
}

export interface Result {
  securities: Security[]
  years: TaxYear[]
  superficial: SuperficialEvent[]
  missingFx: string[]
  warnings: { symbol: string; date: string; text: string }[]
}

export type FxLookup = (date: string) => { rate: number; date: string } | undefined

export const INCLUSION_RATE = 0.5

// ---------- dates ----------
const DAY = 86_400_000
const toMs = (d: string) => Date.parse(d + 'T00:00:00Z')
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY)

/** Settlement date: T+2 business days, T+1 for trades on/after 2024-05-27 (Canadian move to T+1). */
export function settlementDate(trade: string): string {
  // Skips weekends only, not exchange holidays; matters only for the last days of December.
  let left = trade >= '2024-05-27' ? 1 : 2
  let d = trade
  while (left > 0) {
    d = addDays(d, 1)
    const wd = new Date(toMs(d)).getUTCDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d
}

// ---------- helpers ----------
const EPS = 1e-9
const r2 = (n: number) => Math.round(n * 100) / 100
export const cad = (n: number) =>
  (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (n: number) => n.toLocaleString('en-CA', { maximumFractionDigits: 4 })

const KIND_ORDER: Record<TxKind, number> = { split: 0, roc: 1, reinvest: 2, buy: 3, sell: 4 }

/** Stable chronological order; on the same day: splits, adjustments, buys, then sells. */
export function sortTxs(txs: Tx[]): Tx[] {
  return txs
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.date.localeCompare(b.t.date) || KIND_ORDER[a.t.kind] - KIND_ORDER[b.t.kind] || a.i - b.i)
    .map((x) => x.t)
}

/** Shares held of one security per account at end of `date` (inclusive), all accounts. */
function holdingsAt(sorted: Tx[], date: string): Map<string, { type: AccountType; shares: number }> {
  const pos = new Map<string, { type: AccountType; shares: number }>()
  for (const t of sorted) {
    if (t.date > date) break
    if (t.kind === 'split') {
      for (const p of pos.values()) p.shares *= t.ratio || 1
      continue
    }
    // Non-registered accounts share one pool: a sale may come from a different account than the buy.
    const key = isRegistered(t.accountType) ? t.account : '\0non-registered'
    const p = pos.get(key) ?? { type: t.accountType, shares: 0 }
    pos.set(key, p)
    if (t.kind === 'buy') p.shares += t.quantity
    if (t.kind === 'sell') p.shares = Math.max(0, p.shares - t.quantity)
  }
  return pos
}

/**
 * Superficial loss: shares of the same security acquired (any account, incl. TFSA/RRSP) within
 * 30 days before or after the sale and still held at day +30. Denied = loss x min(S, P, B) / S.
 * The part matched to registered accounts can't be added to any ACB and is lost for good.
 */
function superficial(sorted: Tx[], sale: Tx, loss: number): SuperficialEvent | undefined {
  const start = addDays(sale.date, -30)
  const end = addDays(sale.date, 30)
  // S, P and B must share a unit, so everything is restated in shares as of the sale date.
  const splitFactor = (from: string, to: string) =>
    sorted.reduce((f, t) => (t.kind === 'split' && t.date > from && t.date <= to && t.ratio > 0 ? f * t.ratio : f), 1)
  let acquired = 0
  let acquiredReg = 0
  let acquiredByNow = 0
  for (const t of sorted) {
    if (t.kind !== 'buy' || t.date < start || t.date > end) continue
    const units = t.date <= sale.date ? t.quantity * splitFactor(t.date, sale.date) : t.quantity / splitFactor(sale.date, t.date)
    acquired += units
    if (isRegistered(t.accountType)) acquiredReg += units
    else if (t.date <= sale.date) acquiredByNow += units
  }
  let held = 0
  let heldReg = 0
  const endFactor = splitFactor(sale.date, end)
  for (const p of holdingsAt(sorted, end).values()) {
    held += p.shares / endFactor
    if (isRegistered(p.type)) heldReg += p.shares / endFactor
  }
  const S = sale.quantity
  const substituted = Math.min(S, acquired, held)
  if (substituted <= EPS) return undefined
  const subNonReg = Math.min(substituted, acquired - acquiredReg, held - heldReg)
  const denied = (loss * substituted) / S
  const deniedToAcb = substituted > EPS ? (denied * subNonReg) / substituted : 0
  const deniedLost = denied - deniedToAcb
  const sym = sale.symbol
  const parts = [
    `Sold ${qty(S)} ${sym} on ${sale.date} for a ${cad(loss)} loss.`,
    `Between ${start} and ${end} you acquired ${qty(acquired)} shares${acquiredReg > EPS ? ` (${qty(acquiredReg)} in registered accounts)` : ''} and still held ${qty(held)} on ${end}.`,
    `Denied loss = ${cad(loss)} × min(${qty(S)}, ${qty(acquired)}, ${qty(held)}) / ${qty(S)} = ${cad(denied)}.`,
  ]
  if (deniedToAcb > EPS) parts.push(`${cad(deniedToAcb)} is added to the ACB of your remaining ${sym} shares, so you get it back when you eventually sell.`)
  if (deniedLost > 0.005)
    parts.push(`${cad(deniedLost)} is lost permanently: the substitute shares sit in a registered account (TFSA/RRSP/FHSA), where ACB doesn't exist.`)
  return {
    symbol: sym,
    saleId: sale.id,
    date: sale.date,
    windowStart: start,
    windowEnd: end,
    sold: S,
    loss,
    acquired,
    acquiredRegistered: acquiredReg,
    heldAtEnd: held,
    heldAtEndRegistered: heldReg,
    substituted,
    denied,
    deniedToAcb,
    deniedLost,
    substituteHeld: acquiredByNow > EPS,
    explanation: parts.join(' '),
  }
}

export function computeAcb(txs: Tx[], fxLookup: FxLookup = () => undefined): Result {
  const bySymbol = new Map<string, Tx[]>()
  for (const t of txs) {
    const key = t.symbol.trim().toUpperCase()
    if (!key) continue
    bySymbol.set(key, [...(bySymbol.get(key) ?? []), t])
  }
  const missing = new Set<string>()
  const allWarnings: Result['warnings'] = []
  const events: SuperficialEvent[] = []
  const lines: Schedule3Line[] = []
  const securities: Security[] = []

  for (const [symbol, list] of [...bySymbol.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = sortTxs(list)
    const rows: LedgerRow[] = []
    let shares = 0
    let acb = 0
    let realized = 0
    let pendingAdj: { amount: number; event: SuperficialEvent } | undefined
    const reg = new Map<string, RegisteredHolding>()
    const name = sorted.find((t) => t.name)?.name ?? symbol

    const fxFor = (t: Tx): Pick<LedgerRow, 'fx' | 'fxSource' | 'fxDate'> => {
      if (t.currency === 'CAD') return { fx: 1, fxSource: 'CAD' }
      if (t.fxRate && t.fxRate > 0) return { fx: t.fxRate, fxSource: 'manual' }
      const hit = fxLookup(t.date)
      if (hit) return { fx: hit.rate, fxSource: 'BoC', fxDate: hit.date }
      missing.add(t.date)
      return { fx: 1, fxSource: 'missing' }
    }

    const push = (row: Omit<LedgerRow, 'shares' | 'acb' | 'acbPerShare'>) => {
      const full: LedgerRow = { ...row, shares, acb, acbPerShare: shares > EPS ? acb / shares : 0 }
      for (const w of full.warnings) allWarnings.push({ symbol, date: full.date, text: w })
      rows.push(full)
      return full
    }

    for (const t of sorted) {
      const fx: ReturnType<typeof fxFor> = t.kind === 'split' ? { fx: 1, fxSource: 'CAD' } : fxFor(t)
      const warnings: string[] = fx.fxSource === 'missing' ? [`No USD/CAD rate for ${t.date}; treated as 1.0 until a rate loads or you enter one by hand.`] : []

      if (t.kind === 'split') {
        const ratio = t.ratio > 0 ? t.ratio : 1
        for (const h of reg.values()) h.shares *= ratio
        shares *= ratio
        push({ id: t.id, tx: t, kind: 'split', date: t.date, account: t.account, ...fx, quantity: 0, acbDelta: 0, warnings })
        continue
      }

      if (isRegistered(t.accountType)) {
        // Registered accounts have no ACB; track holdings for display and superficial-loss matching.
        const h = reg.get(t.account) ?? { account: t.account, accountType: t.accountType, shares: 0, cost: 0 }
        reg.set(t.account, h)
        if (t.kind === 'buy') {
          h.shares += t.quantity
          h.cost += (t.quantity * t.price + t.commission) * fx.fx
        } else if (t.kind === 'sell') {
          h.cost -= h.shares > EPS ? (h.cost * Math.min(t.quantity, h.shares)) / h.shares : 0
          h.shares = Math.max(0, h.shares - t.quantity)
        }
        continue
      }

      if (t.kind === 'buy') {
        const cost = (t.quantity * t.price + t.commission) * fx.fx
        shares += t.quantity
        acb += cost
        push({ id: t.id, tx: t, kind: 'buy', date: t.date, account: t.account, ...fx, quantity: t.quantity, acbDelta: cost, priceCad: t.price * fx.fx, warnings })
        if (pendingAdj) {
          acb += pendingAdj.amount
          push({
            id: t.id + ':sl',
            tx: t,
            kind: 'superficial-adj',
            date: t.date,
            account: t.account,
            ...fx,
            quantity: 0,
            acbDelta: pendingAdj.amount,
            warnings: [],
            explanation: pendingAdj.event.explanation,
          })
          pendingAdj = undefined
        }
        continue
      }

      if (t.kind === 'reinvest') {
        const amt = t.amount * fx.fx
        acb += amt
        push({ id: t.id, tx: t, kind: 'reinvest', date: t.date, account: t.account, ...fx, quantity: 0, acbDelta: amt, warnings })
        continue
      }

      if (t.kind === 'roc') {
        const amt = t.amount * fx.fx
        acb -= amt
        let gain: number | undefined
        if (acb < -EPS) {
          gain = -acb
          warnings.push(`Return of capital pushed ACB below zero by ${cad(gain)}. That amount is a deemed capital gain for ${t.date.slice(0, 4)} and ACB resets to $0.`)
          acb = 0
          const settle = settlementDate(t.date)
          lines.push({ symbol, name, date: t.date, settlement: settle, quantity: 0, proceeds: gain, acb: 0, outlays: 0, gain, denied: 0, kind: 'deemed' })
          realized += gain
        }
        push({ id: t.id, tx: t, kind: 'roc', date: t.date, account: t.account, ...fx, quantity: 0, acbDelta: -amt, gain, taxYear: gain ? +t.date.slice(0, 4) : undefined, warnings })
        continue
      }

      // sell
      let q = t.quantity
      if (q > shares + EPS) {
        warnings.push(`Sold ${qty(q)} shares but only ${qty(shares)} were held in non-registered accounts. Capped at ${qty(shares)}; check for a missing buy.`)
        q = shares
      }
      const proceeds = q * t.price * fx.fx
      const outlays = t.commission * fx.fx
      const acbSold = shares > EPS ? (acb * q) / shares : 0
      let gain = proceeds - outlays - acbSold
      shares -= q
      acb -= acbSold
      if (shares < EPS) {
        shares = 0
        acb = 0
      }
      let denied = 0
      let explanation: string | undefined
      let absorbNow: SuperficialEvent | undefined
      if (gain < -0.005) {
        const ev = superficial(sorted, { ...t, quantity: q }, -gain)
        if (ev) {
          events.push(ev)
          denied = ev.denied
          gain += denied
          explanation = ev.explanation
          // s.53(1)(f): the denial belongs to the substitute shares, so it waits until they exist.
          // Adding it to unrelated shares still on hand would deny it a second time if those sell at a loss.
          if (ev.deniedToAcb > EPS) {
            if (ev.substituteHeld && shares > EPS) absorbNow = ev
            else pendingAdj = { amount: ev.deniedToAcb + (pendingAdj?.amount ?? 0), event: ev }
          }
        }
      }
      const settle = settlementDate(t.date)
      realized += gain
      lines.push({ symbol, name, date: t.date, settlement: settle, quantity: q, proceeds, acb: acbSold, outlays, gain, denied, kind: 'sale' })
      push({
        id: t.id,
        tx: t,
        kind: 'sell',
        date: t.date,
        account: t.account,
        ...fx,
        quantity: q,
        acbDelta: -acbSold,
        priceCad: t.price * fx.fx,
        proceeds,
        outlays,
        acbSold,
        gain,
        denied,
        taxYear: +settle.slice(0, 4),
        warnings,
        explanation,
      })
      if (absorbNow) {
        acb += absorbNow.deniedToAcb
        push({
          id: t.id + ':sl',
          tx: t,
          kind: 'superficial-adj',
          date: t.date,
          account: t.account,
          ...fx,
          quantity: 0,
          acbDelta: absorbNow.deniedToAcb,
          warnings: [],
          explanation: absorbNow.explanation,
        })
      }
    }

    if (pendingAdj) allWarnings.push({ symbol, date: pendingAdj.event.date, text: `Denied loss of ${cad(pendingAdj.amount)} could not be attached to a later non-registered purchase.` })

    securities.push({
      symbol,
      name,
      currency: sorted.some((t) => t.currency === 'USD') ? 'USD' : 'CAD',
      rows,
      shares,
      acb,
      realized,
      registered: [...reg.values()].filter((h) => h.shares > EPS),
    })
  }

  const yearMap = new Map<number, Schedule3Line[]>()
  for (const l of lines) {
    const y = +l.settlement.slice(0, 4)
    if (l.kind === 'deemed') {
      // Deemed gains arise on the ROC date itself, not a settlement.
      const dy = +l.date.slice(0, 4)
      yearMap.set(dy, [...(yearMap.get(dy) ?? []), l])
      continue
    }
    yearMap.set(y, [...(yearMap.get(y) ?? []), l])
  }
  const years: TaxYear[] = [...yearMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, ls]) => {
      const sum = (f: (l: Schedule3Line) => number) => r2(ls.reduce((s, l) => s + f(l), 0))
      const net = sum((l) => l.gain)
      return {
        year,
        lines: ls.sort((a, b) => a.date.localeCompare(b.date)),
        proceeds: sum((l) => l.proceeds),
        acb: sum((l) => l.acb),
        outlays: sum((l) => l.outlays),
        gains: sum((l) => Math.max(0, l.gain)),
        losses: sum((l) => Math.min(0, l.gain)),
        net,
        denied: sum((l) => l.denied),
        taxable: r2(Math.max(0, net) * INCLUSION_RATE),
      }
    })

  return { securities, years, superficial: events, missingFx: [...missing].sort(), warnings: allWarnings }
}

/** ACB/share and trade prices restated in today's share terms, so a split doesn't draw a cliff. */
export function splitAdjustedSeries(sec: Security) {
  let factor = 1
  const out: { date: string; acbPerShare: number | null; price?: number; side?: 'buy' | 'sell'; row: LedgerRow }[] = []
  for (let i = sec.rows.length - 1; i >= 0; i--) {
    const row = sec.rows[i]
    out.unshift({
      date: row.date,
      acbPerShare: row.shares > EPS ? row.acbPerShare * factor : null,
      price: row.priceCad === undefined ? undefined : row.priceCad * factor,
      side: row.kind === 'buy' || row.kind === 'sell' ? row.kind : undefined,
      row,
    })
    // Rows before this split are in pre-split shares; their per-share values shrink by the ratio.
    if (row.kind === 'split' && row.tx.ratio > 0) factor /= row.tx.ratio
  }
  return out
}

/** Losing sales whose 30-day window is still running: buying back now could still trigger the rule. */
export function openLossWindows(result: Result, today: string) {
  const out: { symbol: string; date: string; until: string; loss: number; quantity: number }[] = []
  for (const sec of result.securities)
    for (const row of sec.rows) {
      if (row.kind !== 'sell') continue
      const until = addDays(row.date, 30)
      const loss = -(row.gain ?? 0) + (row.denied ?? 0)
      if (until >= today && loss > 0.005) out.push({ symbol: sec.symbol, date: row.date, until, loss, quantity: row.quantity })
    }
  return out.sort((a, b) => a.until.localeCompare(b.until))
}
