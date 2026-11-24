import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays as addDaysTo, computeAcb, openLossWindows, settlementDate, splitAdjustedSeries, type Tx } from './engine.ts'
import { lookupFrom } from './fx.ts'
import { YEAR_OF_TRADES, SAMPLE_RATES } from './samples.ts'

let n = 0
const tx = (p: Partial<Tx> & Pick<Tx, 'date' | 'kind'>): Tx => ({
  id: `x${n++}`,
  account: 'Cash',
  accountType: 'Non-registered',
  symbol: 'ABC',
  quantity: 0,
  price: 0,
  commission: 0,
  amount: 0,
  ratio: 1,
  currency: 'CAD',
  ...p,
})
const buy = (date: string, quantity: number, price: number, p: Partial<Tx> = {}) => tx({ date, kind: 'buy', quantity, price, ...p })
const sell = (date: string, quantity: number, price: number, p: Partial<Tx> = {}) => tx({ date, kind: 'sell', quantity, price, ...p })
const near = (a: number | undefined, b: number, eps = 0.005) => assert.ok(a !== undefined && Math.abs(a - b) < eps, `${a} ≉ ${b}`)
const sec = (txs: Tx[], fx = lookupFrom({})) => computeAcb(txs, fx).securities[0]

test('averages cost across buys and includes commissions', () => {
  const s = sec([buy('2025-01-02', 100, 10, { commission: 10 }), buy('2025-02-03', 100, 20, { commission: 10 })])
  near(s.acb, 3020)
  near(s.rows[1].acbPerShare, 15.1)
})

test('sale uses average ACB; commission is an outlay', () => {
  const r = computeAcb([buy('2025-01-02', 100, 10), buy('2025-02-03', 100, 20), sell('2025-06-02', 50, 25, { commission: 5 })])
  const row = r.securities[0].rows[2]
  near(row.acbSold, 750)
  near(row.proceeds, 1250)
  near(row.outlays, 5)
  near(row.gain, 495)
  near(r.securities[0].acb, 2250)
  near(r.years[0].net, 495)
  near(r.years[0].taxable, 247.5)
})

test('pools the same security across all non-registered accounts', () => {
  const s = sec([buy('2025-01-02', 10, 100, { account: 'Personal' }), buy('2025-01-03', 10, 200, { account: 'Joint' }), sell('2025-06-02', 10, 150, { account: 'Personal' })])
  near(s.rows[2].gain, 0) // average 150, not the Personal account's 100
  near(s.shares, 10)
})

test('registered accounts are excluded from ACB but shown as holdings', () => {
  const s = sec([buy('2025-01-02', 10, 100), buy('2025-01-03', 50, 999, { account: 'TFSA', accountType: 'TFSA' })])
  near(s.acb, 1000)
  assert.equal(s.shares, 10)
  assert.equal(s.registered[0].shares, 50)
  assert.equal(s.rows.length, 1)
})

test('stock split multiplies shares and keeps total ACB', () => {
  const s = sec([buy('2024-03-12', 10, 900), tx({ date: '2024-06-10', kind: 'split', ratio: 10 }), sell('2025-01-07', 30, 140)])
  near(s.rows[1].shares, 100)
  near(s.rows[1].acbPerShare, 90)
  near(s.rows[2].gain, 30 * 140 - 30 * 90)
})

test('consolidation (reverse split) works with a fractional ratio', () => {
  const s = sec([buy('2025-01-02', 1000, 1), tx({ date: '2025-03-01', kind: 'split', ratio: 0.1 })])
  near(s.shares, 100)
  near(s.acb, 1000)
  near(s.rows[1].acbPerShare, 10)
})

test('return of capital reduces ACB; reinvested distribution increases it', () => {
  const s = sec([buy('2025-01-02', 100, 20), tx({ date: '2025-12-31', kind: 'roc', amount: 150 }), tx({ date: '2025-12-31', kind: 'reinvest', amount: 40 })])
  near(s.acb, 2000 - 150 + 40)
  assert.equal(s.shares, 100)
})

test('ROC below zero ACB becomes a deemed capital gain and ACB resets to 0', () => {
  const r = computeAcb([buy('2024-01-02', 10, 10), tx({ date: '2024-12-31', kind: 'roc', amount: 130 })])
  const s = r.securities[0]
  near(s.acb, 0)
  near(s.rows[1].gain, 30)
  assert.match(s.rows[1].warnings[0], /below zero/)
  assert.equal(r.years[0].year, 2024)
  near(r.years[0].net, 30)
})

test('USD trades convert at the trade-date rate, both legs', () => {
  const fx = lookupFrom({ '2025-01-02': 1.4, '2025-06-02': 1.3 })
  const s = sec([buy('2025-01-02', 10, 100, { currency: 'USD', commission: 1 }), sell('2025-06-02', 10, 110, { currency: 'USD' })], fx)
  near(s.rows[0].acbDelta, 1001 * 1.4)
  near(s.rows[1].proceeds, 1100 * 1.3)
  near(s.rows[1].gain, 1430 - 1401.4) // a US$99 gain is only C$28.60 once the dollar weakens
})

test('weekend USD trade uses the prior business day rate', () => {
  const fx = lookupFrom({ '2025-03-07': 1.43 }) // Friday
  const s = sec([buy('2025-03-09', 1, 100, { currency: 'USD' })], fx)
  assert.equal(s.rows[0].fxDate, '2025-03-07')
  near(s.rows[0].acb, 143)
})

test('manual fx rate overrides the lookup; missing rate is reported', () => {
  const r = computeAcb([buy('2025-01-02', 1, 100, { currency: 'USD', fxRate: 1.5 }), buy('2025-01-03', 1, 100, { currency: 'USD' })])
  near(r.securities[0].rows[0].acbDelta, 150)
  assert.equal(r.securities[0].rows[1].fxSource, 'missing')
  assert.deepEqual(r.missingFx, ['2025-01-03'])
})

test('superficial loss: full repurchase denies the whole loss and adds it to ACB', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-03-20', 100, 42)])
  const s = r.securities[0]
  const sale = s.rows[1]
  near(sale.gain, 0)
  near(sale.denied, 1000)
  const adj = s.rows.find((x) => x.kind === 'superficial-adj')!
  assert.equal(adj.date, '2025-03-20') // pool was empty at sale, so it waits for the repurchase
  near(s.acb, 4200 + 1000)
  near(r.years[0].denied, 1000)
})

test('superficial loss: partial repurchase is pro-rated min(S, P, B) / S', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-03-10', 30, 41)])
  const sale = r.securities[0].rows[1]
  near(sale.denied, 300)
  near(sale.gain, -700)
  near(r.securities[0].acb, 30 * 41 + 300)
})

test('superficial loss: shares bought 30 days BEFORE the sale and still held count', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), buy('2025-02-20', 50, 45), sell('2025-03-03', 100, 40)])
  const s = r.securities[0]
  const sale = s.rows.find((x) => x.kind === 'sell')!
  // ACB/share = (5000 + 2250)/150 = 48.333; loss = 833.33; P=50, B=50 -> half denied
  near(sale.denied, 833.333 / 2, 0.01)
  const adjIdx = s.rows.findIndex((x) => x.kind === 'superficial-adj')
  assert.equal(s.rows[adjIdx].date, '2025-03-03') // remaining shares absorb it immediately
})

test('superficial loss: no denial when the repurchase is sold before day 30', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-03-10', 100, 41), sell('2025-03-25', 100, 43)])
  assert.equal(r.superficial.length, 0)
  near(r.securities[0].rows[1].gain, -1000)
})

test('superficial loss: repurchase on day 31 is outside the window', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-04-03', 100, 41)])
  assert.equal(r.superficial.length, 0)
  const r2 = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-04-02', 100, 41)])
  assert.equal(r2.superficial.length, 1)
})

test('superficial loss: repurchase in a TFSA denies the loss permanently', () => {
  const r = computeAcb([buy('2024-02-20', 40, 110.5), sell('2024-08-06', 40, 89.1), buy('2024-08-20', 25, 92.4, { account: 'TFSA', accountType: 'TFSA' })])
  const ev = r.superficial[0]
  const loss = 40 * (110.5 - 89.1)
  near(ev.denied, (loss * 25) / 40)
  near(ev.deniedLost, ev.denied)
  near(ev.deniedToAcb, 0)
  near(r.securities[0].acb, 0)
  assert.match(ev.explanation, /lost permanently/)
})

test('superficial loss: USD position, denial computed in CAD', () => {
  const fx = lookupFrom({ '2025-02-03': 1.46, '2025-04-04': 1.42, '2025-04-21': 1.38 })
  const r = computeAcb([buy('2025-02-03', 8, 411.22, { currency: 'USD' }), sell('2025-04-04', 8, 359.84, { currency: 'USD' }), buy('2025-04-21', 5, 367.78, { currency: 'USD' })], fx)
  const loss = 8 * 411.22 * 1.46 - 8 * 359.84 * 1.42
  near(r.superficial[0].denied, (loss * 5) / 8, 0.01)
  near(r.securities[0].acb, 5 * 367.78 * 1.38 + (loss * 5) / 8, 0.01)
})

test('gains are never touched by the superficial loss rule', () => {
  const r = computeAcb([buy('2025-01-02', 10, 10), sell('2025-03-03', 10, 20), buy('2025-03-04', 10, 20)])
  assert.equal(r.superficial.length, 0)
})

test('selling more than held is capped and warned', () => {
  const r = computeAcb([buy('2025-01-02', 10, 10), sell('2025-02-03', 15, 12)])
  assert.equal(r.securities[0].rows[1].quantity, 10)
  assert.match(r.warnings[0].text, /only 10/)
})

test('tax year follows settlement date (T+1 from 2024-05-27, T+2 before)', () => {
  assert.equal(settlementDate('2025-12-31'), '2026-01-02') // Jan 1 holiday skipped
  assert.equal(settlementDate('2023-12-29'), '2024-01-03') // Friday T+2, Jan 1 holiday -> Wednesday
  assert.equal(settlementDate('2025-03-07'), '2025-03-10') // Friday T+1 -> Monday
  const r = computeAcb([buy('2025-01-02', 10, 10), sell('2025-12-31', 10, 20)])
  assert.equal(r.years[0].year, 2026)
})

test('net capital loss year has zero taxable amount', () => {
  const r = computeAcb([buy('2025-01-02', 10, 20), sell('2025-02-03', 10, 10)])
  near(r.years[0].net, -100)
  assert.equal(r.years[0].taxable, 0)
})

test('sample portfolio: superficial losses and totals are consistent', () => {
  const r = computeAcb(YEAR_OF_TRADES, lookupFrom(SAMPLE_RATES))
  assert.deepEqual(r.missingFx, [])
  assert.equal(r.superficial.length, 2)
  const xeqt = r.superficial.find((e) => e.symbol === 'XEQT')!
  near(xeqt.substituted, 80)
  const shop = r.superficial.find((e) => e.symbol === 'SHOP.TO')!
  assert.ok(shop.deniedLost > 0)
  const nvda = r.securities.find((s) => s.symbol === 'NVDA')!
  near(nvda.shares, 30)
  for (const y of r.years) near(y.net, y.lines.reduce((s, l) => s + l.gain, 0), 0.02)
})

// ---------- superficial loss, partial cases ----------
const TFSA = { account: 'TFSA', accountType: 'TFSA' as const }

test('superficial loss: repurchase partly sold before day 30 uses shares held at the end', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-03-10', 100, 41), sell('2025-03-25', 60, 43)])
  const ev = r.superficial[0]
  near(ev.substituted, 40)
  near(ev.denied, 400)
  near(r.securities[0].rows[1].gain, -600)
})

test('superficial loss: several small buys in the window add up', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-03-05', 10, 41), buy('2025-03-20', 15, 42), buy('2025-04-02', 5, 43)])
  near(r.superficial[0].acquired, 30)
  near(r.superficial[0].denied, 300)
})

test('superficial loss: buying more than was sold caps the denial at 100%', () => {
  const r = computeAcb([buy('2025-01-02', 50, 50), sell('2025-03-03', 50, 40), buy('2025-03-10', 500, 41)])
  near(r.superficial[0].denied, 500)
  near(r.securities[0].rows[1].gain, 0)
})

test('superficial loss: partial sale with prior long-held shares, no new buy, stays allowed', () => {
  const r = computeAcb([buy('2024-01-02', 100, 50), sell('2025-03-03', 50, 40)])
  assert.equal(r.superficial.length, 0)
  near(r.securities[0].rows[1].gain, -500)
})

test('superficial loss: buy exactly 30 days before counts, 31 days before does not', () => {
  const at = (d: string) => computeAcb([buy('2024-01-02', 100, 50), buy(d, 20, 45), sell('2025-03-31', 50, 40)]).superficial.length
  assert.equal(at('2025-03-01'), 1)
  assert.equal(at('2025-02-28'), 0)
})

test('superficial loss: denied amount splits between ACB and a TFSA repurchase', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-03-10', 40, 41), buy('2025-03-11', 60, 41, TFSA)])
  const ev = r.superficial[0]
  near(ev.denied, 1000)
  near(ev.deniedToAcb, 400)
  near(ev.deniedLost, 600)
  near(r.securities[0].acb, 40 * 41 + 400)
})

test('superficial loss: denied ACB comes back as a smaller loss on the eventual sale', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-03-10', 100, 41), sell('2025-09-02', 100, 41)])
  near(r.securities[0].rows.find((x) => x.date === '2025-09-02')!.gain, -1000)
  near(r.years[0].net, -1000) // total economic loss survives, only its timing moved
})

test('superficial loss: two denied sales before any repurchase both reach the ACB', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 50, 40), sell('2025-03-03', 50, 40), buy('2025-03-10', 100, 41)])
  near(r.superficial.reduce((a, e) => a + e.denied, 0), 1000)
  near(r.securities[0].acb, 4100 + 1000)
})

test('superficial loss: split inside the window restates held shares to the sale date', () => {
  // 100 rebought, 10-for-1, then 500 new shares sold: 500 new = 50 sale-date shares still held.
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-03-10', 100, 41), tx({ date: '2025-03-15', kind: 'split', ratio: 10 }), sell('2025-03-20', 500, 5)])
  near(r.superficial[0].substituted, 50)
  near(r.superficial[0].denied, 500)
})

test('superficial loss: consolidation inside the window restates too', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 100, 40), buy('2025-03-10', 100, 41), tx({ date: '2025-03-15', kind: 'split', ratio: 0.1 })])
  near(r.superficial[0].substituted, 100)
  near(r.superficial[0].denied, 1000)
})

test('superficial loss: pre-sale buy is restated by a split before the sale', () => {
  // 20 bought, 2-for-1 = 40 shares by the sale date; 100 sold of 240, none rebought after.
  const r = computeAcb([buy('2024-01-02', 100, 50), buy('2025-02-20', 20, 45), tx({ date: '2025-02-25', kind: 'split', ratio: 2 }), sell('2025-03-03', 100, 20)])
  near(r.superficial[0].acquired, 40)
  near(r.superficial[0].substituted, 40)
})

// ---------- superficial loss, several sales sharing replacement shares ----------
// The Act and the CRA letters only describe one disposition, so the figures stay as tested sale by sale. A sale that shares
// replacement shares with another one is warned, with the other reading (each replacement share matched once) beside it.
const shareWarnings = (r: ReturnType<typeof computeAcb>) => r.warnings.filter((w) => w.text.startsWith('Replacement shares are shared'))

test('shared replacement: one order of 100 is unchanged and not warned', () => {
  const r = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 100, 10), buy('2026-06-10', 50, 10)])
  near(r.superficial[0].denied, 500)
  assert.equal(r.superficial[0].shared, undefined)
  assert.equal(shareWarnings(r).length, 0)
  near(r.years[0].net, -500)
})

test('shared replacement: two orders of 50 keep the old figures but both sales are warned with both readings', () => {
  const r = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 50, 10), sell('2026-06-02', 50, 10), buy('2026-06-10', 50, 10)])
  // As computed, exactly as before: each sale on its own, both denials reach the ACB.
  assert.deepEqual(r.superficial.map((e) => e.denied), [500, 500])
  near(r.years[0].denied, 1000)
  near(r.years[0].net, 0)
  near(r.securities[0].acb, 1500)
  const [a, b] = r.superficial
  near(a.shared?.deniedOnce, 500)
  near(b.shared?.deniedOnce, 0)
  near(a.shared?.groupDenied, 1000)
  near(a.shared?.groupDeniedOnce, 500)
  assert.deepEqual(a.shared?.withDates, ['2026-06-02'])
  assert.deepEqual(b.shared?.withDates, ['2026-06-01'])
  assert.deepEqual(a.shared?.boughtDates, ['2026-06-10'])
  const w = shareWarnings(r)
  assert.equal(w.length, 2)
  assert.match(w[0].text, /\$1,000\.00 in total as computed, or \$500\.00 if each replacement share is matched to one sale only/)
  assert.match(b.explanation, /bought on 2026-06-10 also count for the loss sale on 2026-06-01/)
  assert.match(b.explanation, /denied \$500\.00; if each replacement share is matched to one sale only \(earliest sale first\) it is denied \$0\.00/)
  // The ledger rows carry the same text, and the ledger numbers match the events.
  const rows = r.securities[0].rows.filter((x) => x.kind === 'sell')
  assert.deepEqual(rows.map((x) => x.denied), [500, 500])
  assert.ok(rows.every((x) => x.explanation?.includes('Shared replacement shares') && x.warnings.length === 1))
})

test('shared replacement: sales on different days count, sales whose windows share no purchase do not', () => {
  const far = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 50, 10), buy('2026-06-10', 50, 10), sell('2026-08-20', 50, 5)])
  assert.equal(far.superficial.length, 1)
  assert.equal(shareWarnings(far).length, 0)
  const near30 = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 50, 10), sell('2026-06-25', 50, 10), buy('2026-06-30', 50, 10)])
  assert.equal(shareWarnings(near30).length, 2)
  const sameDay = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 50, 10), sell('2026-06-01', 50, 10), buy('2026-06-10', 50, 10)])
  assert.equal(shareWarnings(sameDay).length, 2)
  near(sameDay.years[0].denied, 1000)
})

test('shared replacement: partial replacement, 30 shares for two sales of 50', () => {
  const r = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 50, 10), sell('2026-06-02', 50, 10), buy('2026-06-10', 30, 10)])
  assert.deepEqual(r.superficial.map((e) => e.denied), [300, 300])
  assert.deepEqual(r.superficial.map((e) => e.shared?.deniedOnce), [300, 0])
  near(r.superficial[0].shared?.groupDeniedOnce, 300)
})

test('shared replacement: enough shares to replace every sale means the readings agree and nothing is warned', () => {
  const r = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 50, 10), sell('2026-06-02', 50, 10), buy('2026-06-10', 100, 10)])
  near(r.years[0].denied, 1000)
  assert.ok(r.superficial.every((e) => e.shared === undefined))
  assert.equal(shareWarnings(r).length, 0)
  const more = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 50, 10), sell('2026-06-02', 50, 10), buy('2026-06-10', 500, 10)])
  near(more.years[0].denied, 1000)
  assert.equal(shareWarnings(more).length, 0)
})

test('shared replacement: a TFSA repurchase keeps the permanently lost part as computed and is warned', () => {
  const r = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 50, 10), sell('2026-06-02', 50, 10), buy('2026-06-10', 50, 10, { account: 'TFSA', accountType: 'TFSA' })])
  assert.deepEqual(r.superficial.map((e) => [e.denied, e.deniedToAcb, e.deniedLost]), [[500, 0, 500], [500, 0, 500]])
  near(r.securities[0].acb, 0)
  assert.equal(shareWarnings(r).length, 2)
  near(r.superficial[0].shared?.groupDeniedOnce, 500)
})

test('shared replacement: a replacement bought before the sales is shared too', () => {
  const r = computeAcb([buy('2026-01-05', 100, 20), buy('2026-05-25', 50, 10), sell('2026-06-01', 50, 10), sell('2026-06-02', 50, 10)])
  assert.equal(shareWarnings(r).length, 2)
  near(r.superficial[0].denied, (2500 / 150 - 10) * 50)
  near(r.superficial[0].shared?.deniedOnce, r.superficial[0].denied)
  near(r.superficial[1].shared?.deniedOnce, 0)
})

test('shared replacement: a split between the sales restates the shares before they are compared', () => {
  // 100 bought, 50 sold, 2-for-1, 50 sold of the 100 now held, then 50 post-split shares bought.
  const r = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 50, 10), tx({ date: '2026-06-02', kind: 'split', ratio: 2 }), sell('2026-06-03', 50, 5), buy('2026-06-10', 50, 5)])
  const [a, b] = r.superficial
  near(a.substituted, 25) // 50 post-split shares are 25 sale-date shares
  near(a.denied, 250)
  near(b.substituted, 50)
  near(b.denied, 250)
  near(a.shared?.groupDenied, 500)
  near(a.shared?.groupDeniedOnce, 250)
  near(a.shared?.deniedOnce, 250)
  near(b.shared?.deniedOnce, 0)
})

test('shared replacement: once-matched figures never exceed the loss or the as-computed figures', () => {
  // A later sale in the window sells most of the replacement shares again, so fewer are held at the end.
  const r = computeAcb([buy('2026-01-05', 200, 20), sell('2026-06-01', 50, 10), sell('2026-06-02', 50, 10), buy('2026-06-10', 100, 10), sell('2026-06-20', 110, 10)])
  for (const e of r.superficial) if (e.shared) {
    assert.ok(e.shared.deniedOnce <= e.loss + 1e-9)
    assert.ok(e.shared.groupDeniedOnce <= e.shared.groupDenied + 1e-9)
  }
})

test('shared replacement: unreadable quantities never print a NaN warning', () => {
  const r = computeAcb([buy('2026-01-05', 100, 20), sell('2026-06-01', 50, 10), sell('2026-06-02', 50, 10), buy('2026-06-10', Number.NaN, 10)])
  assert.ok(r.warnings.every((w) => !w.text.includes('NaN')))
  assert.ok(r.superficial.every((e) => e.shared === undefined))
})

test('shared replacement: warnings only add to the figures, which always reconcile with the ledger (randomised)', () => {
  let seed = 7
  const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
  let flagged = 0
  for (let c = 0; c < 1500; c++) {
    const txs: Tx[] = [buy('2026-01-05', int(50, 300), 20)]
    for (let i = int(2, 7); i > 0; i--) {
      const date = addDaysTo('2026-04-01', int(0, 75))
      const reg = rnd() < 0.2 ? { account: 'TFSA', accountType: 'TFSA' as const } : {}
      txs.push(rnd() < 0.5 ? sell(date, int(1, 80), int(5, 25)) : rnd() < 0.15 ? tx({ date, kind: 'split', ratio: rnd() < 0.5 ? 2 : 0.5 }) : buy(date, int(1, 80), int(5, 25), reg))
    }
    const r = computeAcb(txs)
    const sellRows = r.securities[0].rows.filter((x) => x.kind === 'sell')
    const lossTotal = r.superficial.reduce((a, e) => a + e.loss, 0)
    const deniedTotal = r.superficial.reduce((a, e) => a + e.denied, 0)
    near(sellRows.reduce((a, x) => a + (x.denied ?? 0), 0), deniedTotal, 0.01) // ledger denied = events
    assert.ok(deniedTotal <= lossTotal + 1e-6, 'total denied never exceeds the total loss')
    const toAcb = r.superficial.reduce((a, e) => a + e.deniedToAcb, 0)
    const lost = r.superficial.reduce((a, e) => a + e.deniedLost, 0)
    near(toAcb + lost, deniedTotal, 0.01)
    for (const e of r.superficial) if (e.shared) {
      flagged++
      assert.ok(e.shared.deniedOnce >= -1e-9 && e.shared.deniedOnce <= e.denied + 1e-6)
      assert.ok(e.shared.groupDeniedOnce < e.shared.groupDenied - 0.005 || e.shared.groupDeniedOnce > e.shared.groupDenied + 0.005)
      assert.ok(r.warnings.some((w) => w.date === e.date && w.text.startsWith('Replacement shares are shared')))
    }
  }
  assert.ok(flagged > 20, `expected the generator to reach shared cases, got ${flagged}`)
})

// ---------- FX ----------
test('a split on a USD stock needs no FX rate', () => {
  const r = computeAcb([buy('2024-03-12', 10, 900, { currency: 'USD', fxRate: 1.35 }), tx({ date: '2024-06-10', kind: 'split', ratio: 10, currency: 'USD' })])
  assert.deepEqual(r.missingFx, [])
  assert.equal(r.warnings.length, 0)
})

test('USD return of capital and commission convert at the rate of their own date', () => {
  const fx = lookupFrom({ '2025-01-02': 1.4, '2025-12-31': 1.3 })
  const s = sec([buy('2025-01-02', 10, 100, { currency: 'USD', commission: 10 }), tx({ date: '2025-12-31', kind: 'roc', amount: 100, currency: 'USD' })], fx)
  near(s.acb, 1010 * 1.4 - 100 * 1.3)
})

test('USD gain can be a CAD loss when the dollar falls', () => {
  const fx = lookupFrom({ '2025-01-02': 1.45, '2025-06-02': 1.3 })
  const s = sec([buy('2025-01-02', 10, 100, { currency: 'USD' }), sell('2025-06-02', 10, 105, { currency: 'USD' })], fx)
  near(s.rows[1].gain, 1365 - 1450)
})

test('mixed CAD and USD lots of one symbol pool in CAD', () => {
  const fx = lookupFrom({ '2025-01-03': 1.5 })
  const s = sec([buy('2025-01-02', 10, 150), buy('2025-01-03', 10, 100, { currency: 'USD' })], fx)
  near(s.acb, 3000)
  near(s.rows[1].acbPerShare, 150)
})

// ---------- splits, ROC, ordering ----------
test('fractional shares survive a split and a full sale leaves exactly zero', () => {
  const s = sec([buy('2025-01-02', 0.1, 30), buy('2025-01-03', 0.2, 30), tx({ date: '2025-02-03', kind: 'split', ratio: 3 }), sell('2025-03-03', 0.9, 11)])
  assert.equal(s.shares, 0)
  assert.equal(s.acb, 0)
})

test('split also applies to registered holdings', () => {
  const s = sec([buy('2025-01-02', 10, 100), buy('2025-01-02', 5, 100, TFSA), tx({ date: '2025-02-03', kind: 'split', ratio: 2 })])
  near(s.shares, 20)
  near(s.registered[0].shares, 10)
})

test('ROC and distributions in a TFSA are ignored', () => {
  const s = sec([buy('2025-01-02', 10, 100), tx({ date: '2025-12-31', kind: 'roc', amount: 50, ...TFSA }), tx({ date: '2025-12-31', kind: 'reinvest', amount: 50, ...TFSA })])
  near(s.acb, 1000)
})

test('ROC lowers the per-share cost used for a later sale', () => {
  const s = sec([buy('2025-01-02', 100, 20), tx({ date: '2025-06-30', kind: 'roc', amount: 200 }), sell('2025-09-02', 50, 25)])
  near(s.rows[2].acbSold, 900)
  near(s.rows[2].gain, 350)
})

test('after a negative-ACB reset the next buy starts from zero', () => {
  const s = sec([buy('2025-01-02', 10, 10), tx({ date: '2025-06-30', kind: 'roc', amount: 150 }), buy('2025-07-02', 10, 10), sell('2025-09-02', 20, 12)])
  near(s.rows[2].acb, 100)
  near(s.rows[3].gain, 240 - 100)
})

test('same-day buy is processed before the sell', () => {
  const s = sec([sell('2025-02-03', 10, 12), buy('2025-02-03', 10, 10)])
  near(s.rows[1].gain, 20)
  assert.equal(s.rows[1].warnings.length, 0)
})

test('Dec 30 2025 sale is tax year 2025, Dec 31 settles into 2026', () => {
  const r = computeAcb([buy('2025-01-02', 20, 10), sell('2025-12-30', 10, 20), sell('2025-12-31', 10, 20)])
  assert.deepEqual(r.years.map((y) => y.year), [2025, 2026])
})

test('chart series restates pre-split values so a split draws no cliff', () => {
  const s = sec([buy('2024-03-12', 10, 900), tx({ date: '2024-06-10', kind: 'split', ratio: 10 }), sell('2025-01-07', 30, 140)])
  const pts = splitAdjustedSeries(s)
  near(pts[0].acbPerShare!, 90)
  near(pts[0].price!, 90)
  near(pts[1].acbPerShare!, 90)
  near(pts[2].price!, 140)
})

test('open loss windows list recent losing sales, even when already denied', () => {
  const r = computeAcb([buy('2025-01-02', 100, 50), sell('2025-03-03', 50, 40), sell('2025-01-20', 10, 60)])
  assert.deepEqual(openLossWindows(r, '2025-03-20').map((w) => [w.date, w.until]), [['2025-03-03', '2025-04-02']])
  assert.equal(openLossWindows(r, '2025-04-03').length, 0)
})

test('superficial loss: a sale from another non-registered account does not inflate shares held', () => {
  // Everything was sold, just from a different account than the buy, so nothing is held at day 30.
  const r = computeAcb([buy('2025-01-02', 100, 50, { account: 'Joint' }), buy('2025-03-01', 100, 40, { account: 'Joint' }), sell('2025-03-10', 200, 30, { account: 'Personal' })])
  assert.equal(r.superficial.length, 0)
  near(r.years[0].net, -3000)
})

test('superficial loss: denial waits for a later repurchase instead of landing on old shares', () => {
  const s = sec([buy('2025-01-02', 100, 50), sell('2025-03-03', 40, 40), buy('2025-03-20', 40, 41)])
  assert.deepEqual(s.rows.map((x) => x.kind), ['buy', 'sell', 'buy', 'superficial-adj'])
  near(s.acb, 60 * 50 + 40 * 41 + 400)
})

test('superficial loss: pre-sale substitute shares absorb the denial on the sale date', () => {
  const s = sec([buy('2025-01-02', 100, 50), buy('2025-02-20', 40, 40), sell('2025-03-03', 40, 30)])
  assert.deepEqual(s.rows.map((x) => x.kind), ['buy', 'buy', 'sell', 'superficial-adj'])
  near(s.acb, 6600 - 1200) // pool cost minus proceeds: the whole loss stays in the ACB
})

test('settlement skips year-end exchange holidays', async () => {
  const { isYearEndHoliday } = await import('./engine.ts')
  // 2025: Dec 25 Thu and Dec 26 Fri are both closed, so a Christmas Eve trade settles the next Monday.
  assert.equal(settlementDate('2025-12-24'), '2025-12-29')
  // T+1 trade on Dec 31 settles past New Year's Day: next tax year.
  assert.equal(settlementDate('2025-12-31'), '2026-01-02')
  assert.equal(settlementDate('2025-12-30'), '2025-12-31')
  // 2022 (T+2): Christmas Sunday and Boxing Day Monday observed on Dec 26 and 27.
  assert.equal(settlementDate('2022-12-23'), '2022-12-29')
  // 2021: Christmas on Saturday, observed Mon 27 and Tue 28.
  assert.equal(settlementDate('2021-12-24'), '2021-12-30')
  // New Year's Day 2023 fell on a Sunday, observed Monday Jan 2.
  assert.equal(settlementDate('2022-12-29'), '2023-01-03')
  assert.ok(isYearEndHoliday('2022-01-03')) // Jan 1 2022 was a Saturday
  assert.ok(!isYearEndHoliday('2024-01-02'))
})

test('year-end sale on the last T+1 day lands in the same tax year, the next day in the following one', () => {
  const tx = (id: string, date: string, kind: 'buy' | 'sell', q: number, p: number): Tx => ({ id, date, account: 'A', accountType: 'Non-registered', symbol: 'XIC', kind, quantity: q, price: p, commission: 0, amount: 0, ratio: 1, currency: 'CAD' })
  const r = computeAcb([tx('b', '2025-01-10', 'buy', 100, 30), tx('s1', '2025-12-30', 'sell', 10, 40), tx('s2', '2025-12-31', 'sell', 10, 40)])
  assert.deepEqual(r.years.map((y) => [y.year, Math.round(y.net)]), [[2025, 100], [2026, 100]])
})
