import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMap, detectFormat, importRows, importStatement, ledgerCsv, parseCsv, parseDate, parseNum, schedule3Csv, txKey, txsToCsv, TEMPLATE_EXAMPLE, type ImportOptions } from './csv.ts'
import { computeAcb } from './engine.ts'
import { WS_ACTIVITIES_CSV, WS_STATEMENT_CSV } from './samples.ts'
import { lookupFrom, parseValet, rateOn, uncovered, withGaps } from './fx.ts'
import { YEAR_OF_TRADES, SAMPLE_RATES } from './samples.ts'

const opts: ImportOptions = { defaultAccount: 'Personal', defaultAccountType: 'Non-registered', defaultCurrency: 'CAD' }

test('parseCsv handles quotes, escaped quotes, CRLF and BOM', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\r\n\r\n')
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"']])
})

test('parseNum understands currency, thousands, parentheses and French decimals', () => {
  assert.equal(parseNum('$1,234.50'), 1234.5)
  assert.equal(parseNum('(12.00)'), -12)
  assert.equal(parseNum('12,5'), 12.5)
  assert.equal(parseNum('1.234,56'), 1234.56)
  assert.ok(Number.isNaN(parseNum('')))
})

test('Wealthsimple activities export: trades imported, dividends and deposits skipped', () => {
  const rows = parseCsv(WS_ACTIVITIES_CSV)
  assert.equal(detectFormat(rows[0]), 'ws-activities')
  const { txs, skipped } = importRows(rows, autoMap(rows[0]), opts)
  assert.equal(txs.length, 9)
  assert.equal(skipped.length, 3)
  const sell = txs.find((t) => t.symbol === 'TD' && t.kind === 'sell')!
  assert.equal(sell.quantity, 60) // negative quantity normalised
  const tfsa = txs.find((t) => t.accountType === 'TFSA')!
  assert.equal(tfsa.symbol, 'ENB')
  assert.equal(txs.find((t) => t.symbol === 'MSFT')!.currency, 'USD')
})

test('French Wealthsimple headers map automatically', () => {
  const csv = 'date_effet,compte_id,type_compte,type_activite,sous_type_activite,symbole,nom,devise,quantite,prix_unitaire,commission,montant_net_especes\n2024-03-01,X1,CELI,Trade,BUY,PINE,Pine Inc.,CAD,10,"20,5",0,-205\n'
  const rows = parseCsv(csv)
  assert.equal(detectFormat(rows[0]), 'ws-activities')
  const { txs } = importRows(rows, autoMap(rows[0]), opts)
  assert.equal(txs[0].accountType, 'TFSA')
  assert.equal(txs[0].price, 20.5)
})

test('monthly statement: shares parsed from description, price from amount', () => {
  const rows = parseCsv(WS_STATEMENT_CSV)
  assert.equal(detectFormat(rows[0]), 'ws-statement')
  const { txs, skipped } = importStatement(rows, { ...opts, defaultAccountType: 'TFSA' })
  assert.equal(txs.length, 3)
  assert.equal(skipped.length, 2)
  assert.equal(txs[0].symbol, 'XIC')
  assert.equal(txs[0].quantity, 40)
  assert.equal(txs[0].price, 42.61)
  assert.equal(txs[2].kind, 'sell')
  assert.equal(txs[0].accountType, 'TFSA')
})

test('template round-trips through export and import', () => {
  const rows = parseCsv(TEMPLATE_EXAMPLE)
  assert.equal(detectFormat(rows[0]), 'template')
  const a = importRows(rows, autoMap(rows[0]), opts).txs
  const rows2 = parseCsv(txsToCsv(a))
  const b = importRows(rows2, autoMap(rows2[0]), opts).txs
  assert.equal(b.length, 6)
  assert.deepEqual(
    b.map((t) => [t.kind, t.symbol, t.quantity, t.price, t.amount, t.ratio, t.currency]),
    a.map((t) => [t.kind, t.symbol, t.quantity, t.price, t.amount, t.ratio, t.currency]),
  )
})

test('unknown format: custom mapping and quantity sign infer buy/sell', () => {
  const rows = parseCsv('When,Ticker,Units,Cost\n01/15/2025 is bad,X,1,1\nJan 15 2025,VFV,10,140\nJan 20 2025,VFV,-4,142\n')
  assert.equal(detectFormat(rows[0]), 'unknown')
  const { txs, skipped } = importRows(rows, { date: 0, symbol: 1, quantity: 2, price: 3 }, opts)
  assert.equal(txs.length, 2)
  assert.equal(txs[1].kind, 'sell')
  assert.equal(txs[1].quantity, 4)
  assert.equal(skipped[0].line, 2)
})

test('Valet JSON parsing and prior-business-day lookup', () => {
  const rates = parseValet({ observations: [{ d: '2025-04-17', FXUSDCAD: { v: '1.3862' } }] })
  assert.deepEqual(rateOn(rates, '2025-04-21'), { rate: 1.3862, date: '2025-04-17' }) // Good Friday + weekend
  assert.equal(rateOn(rates, '2025-05-30'), undefined)
})

test('a partial FX cache does not hide a Monday behind Friday; holidays stay covered after a fetch', () => {
  const rates = { '2025-01-10': 1.44 }
  assert.deepEqual(uncovered(rates, ['2025-01-13']), ['2025-01-13'])
  const filled = withGaps({ '2025-04-17': 1.3862, '2025-04-21': 1.382 }, '2025-04-17', '2025-04-21', '2026-01-01')
  assert.deepEqual(uncovered(filled, ['2025-04-18', '2025-04-19', '2025-04-21']), [])
  assert.deepEqual(rateOn(filled, '2025-04-19'), { rate: 1.3862, date: '2025-04-17' })
})

test('the last two days stay unmarked so a late-published rate is fetched later', () => {
  const filled = withGaps({}, '2026-01-05', '2026-01-09', '2026-01-09')
  assert.deepEqual(Object.keys(filled), ['2026-01-05', '2026-01-06', '2026-01-07'])
})

test('activity_type is the fallback when the sub type is blank; DRIP with shares is a buy', () => {
  const csv = 'transaction_date,account_type,activity_type,activity_sub_type,symbol,currency,quantity,unit_price,commission,net_cash_amount\n2025-06-30,Non-registered,ReturnOfCapital,,REI,CAD,,,,12.50\n2025-06-30,Non-registered,Dividend,REINVEST,REI,CAD,1.5,18,0,-27\n2025-06-30,Non-registered,Dividend,,REI,CAD,,,,9\n'
  const rows = parseCsv(csv)
  const { txs, skipped } = importRows(rows, autoMap(rows[0]), opts)
  assert.deepEqual(txs.map((t) => t.kind), ['roc', 'buy'])
  assert.equal(txs[0].amount, 12.5)
  assert.equal(skipped.length, 1)
})

test('parseDate reads unambiguous slashes and refuses to guess', () => {
  assert.equal(parseDate('2025-01-15 09:30:00'), '2025-01-15')
  assert.equal(parseDate('01/15/2025'), '2025-01-15')
  assert.equal(parseDate('15/01/2025'), '2025-01-15')
  assert.equal(parseDate('03/04/2025'), null)
})

test('ledger and Schedule 3 exports reconcile with the engine', () => {
  const r = computeAcb(YEAR_OF_TRADES, lookupFrom(SAMPLE_RATES))
  const led = parseCsv(ledgerCsv(r))
  assert.equal(led.length - 1, r.securities.reduce((a, s) => a + s.rows.length, 0))
  const s3 = parseCsv(schedule3Csv(r))
  const col = s3[0].indexOf('gain_loss')
  for (const y of r.years) assert.equal(Number(s3.find((x) => x[0] === String(y.year) && x[1] === 'TOTAL')![col]), y.net)
})

test('txKey spots a re-imported row', () => {
  const rows = parseCsv(WS_ACTIVITIES_CSV)
  const a = importRows(rows, autoMap(rows[0]), opts).txs
  const b = importRows(rows, autoMap(rows[0]), opts).txs
  assert.equal(new Set([...a, ...b].map(txKey)).size, a.length)
})
