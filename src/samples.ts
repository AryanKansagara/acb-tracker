// Realistic sample portfolios. Prices approximate real closes; USD/CAD comes from the Bank of Canada.
import type { AccountType, Currency, Tx, TxKind } from './engine.ts'
import type { Rates } from './fx.ts'

type Row = [date: string, account: string, symbol: string, kind: TxKind, qty: number, price: number, extra?: number, note?: string]

const ACCOUNTS: Record<string, { type: AccountType; currency: Currency }> = {
  'Personal': { type: 'Non-registered', currency: 'CAD' },
  'Joint': { type: 'Non-registered', currency: 'CAD' },
  'Personal USD': { type: 'Non-registered', currency: 'USD' },
  'TFSA': { type: 'TFSA', currency: 'CAD' },
}

const NAMES: Record<string, string> = {
  XEQT: 'iShares Core Equity ETF Portfolio',
  'SHOP.TO': 'Shopify Inc.',
  'REI.UN': 'RioCan REIT',
  AAPL: 'Apple Inc.',
  NVDA: 'NVIDIA Corp.',
  VFV: 'Vanguard S&P 500 Index ETF',
}

const build = (prefix: string, rows: Row[]): Tx[] =>
  rows.map(([date, account, symbol, kind, quantity, price, extra = 0, note], i) => ({
    id: `${prefix}${i}`,
    date,
    account,
    accountType: ACCOUNTS[account].type,
    symbol,
    name: NAMES[symbol],
    kind,
    quantity: kind === 'buy' || kind === 'sell' ? quantity : 0,
    price: kind === 'buy' || kind === 'sell' ? price : 0,
    commission: kind === 'buy' || kind === 'sell' ? extra : 0,
    amount: kind === 'roc' || kind === 'reinvest' ? extra : 0,
    ratio: kind === 'split' ? extra : 1,
    currency: ACCOUNTS[account].currency,
    note,
  }))

/** Two years of a typical self-directed investor, across CAD, USD and TFSA accounts. */
export const YEAR_OF_TRADES: Tx[] = build('y', [
  ['2024-01-15', 'Personal', 'XEQT', 'buy', 200, 27.4],
  ['2024-02-20', 'Personal', 'SHOP.TO', 'buy', 40, 110.5],
  ['2024-03-01', 'Personal', 'REI.UN', 'buy', 300, 17.8, 9.99, 'Bought at another broker, $9.99 commission'],
  ['2024-03-12', 'Personal USD', 'NVDA', 'buy', 10, 919.13],
  ['2024-06-10', 'Personal USD', 'NVDA', 'split', 0, 0, 10, '10-for-1 stock split'],
  ['2024-06-14', 'Personal', 'XEQT', 'buy', 100, 29.05],
  ['2024-07-02', 'Personal USD', 'AAPL', 'buy', 15, 217.49],
  ['2024-08-06', 'Personal', 'SHOP.TO', 'sell', 40, 89.1, 0, 'Tax-loss harvest...'],
  ['2024-08-20', 'TFSA', 'SHOP.TO', 'buy', 25, 92.4, 0, '...then bought back in the TFSA'],
  ['2024-12-31', 'Personal', 'XEQT', 'reinvest', 0, 0, 38.2, 'Reinvested capital gains distribution (T3 box 21)'],
  ['2024-12-31', 'Personal', 'REI.UN', 'roc', 0, 0, 61.2, 'Return of capital (T3 box 42)'],
  ['2025-01-02', 'TFSA', 'XEQT', 'buy', 100, 32.5],
  ['2025-01-02', 'TFSA', 'VFV', 'buy', 50, 143.1],
  ['2025-01-07', 'Personal USD', 'NVDA', 'sell', 30, 140.14],
  ['2025-02-21', 'Personal USD', 'AAPL', 'sell', 8, 245.55],
  ['2025-03-03', 'Personal', 'XEQT', 'buy', 150, 33.1],
  ['2025-04-07', 'Personal', 'XEQT', 'sell', 120, 28.05, 0, 'Sold in the April tariff dip'],
  ['2025-04-22', 'Personal', 'XEQT', 'buy', 80, 29.1, 0, 'Bought some back two weeks later'],
  ['2025-05-12', 'Personal', 'SHOP.TO', 'buy', 20, 155.2],
  ['2025-08-12', 'Personal USD', 'NVDA', 'sell', 40, 183.16],
  ['2025-11-14', 'Personal', 'SHOP.TO', 'sell', 20, 228.4],
  ['2025-12-30', 'Personal', 'XEQT', 'reinvest', 0, 0, 51.1, 'Reinvested capital gains distribution (T3 box 21)'],
  ['2025-12-31', 'Personal', 'REI.UN', 'roc', 0, 0, 58.4, 'Return of capital (T3 box 42)'],
])

/** The landing page ledger: one ETF, two accounts, a partial superficial loss, ROC and a final gain. */
export const HERO_TRADES: Tx[] = build('h', [
  ['2025-01-15', 'Personal', 'XEQT', 'buy', 200, 31.2],
  ['2025-03-03', 'Joint', 'XEQT', 'buy', 100, 33.1],
  ['2025-04-07', 'Personal', 'XEQT', 'sell', 120, 28.05],
  ['2025-04-22', 'Joint', 'XEQT', 'buy', 80, 29.1],
  ['2025-06-30', 'Personal', 'XEQT', 'reinvest', 0, 0, 38.2],
  ['2025-09-30', 'Personal', 'XEQT', 'roc', 0, 0, 61.2],
  ['2025-11-14', 'Joint', 'XEQT', 'sell', 100, 36.4],
])

/** A raw Wealthsimple Activities export, run through the real importer. */
export const WS_ACTIVITIES_CSV = `transaction_date,settlement_date,account_id,account_type,activity_type,activity_sub_type,direction,symbol,name,currency,quantity,unit_price,commission,net_cash_amount
2025-01-06,2025-01-07,HQ4K2Z7CAD,Non-registered,MoneyMovement,EFT,,,,CAD,,,,10000
2025-01-08,2025-01-09,HQ4K2Z7CAD,Non-registered,Trade,BUY,LONG,TD,Toronto-Dominion Bank,CAD,60,79.85,0,-4791.00
2025-01-08,2025-01-09,HQ4K2Z7CAD,Non-registered,Trade,BUY,LONG,ENB,Enbridge Inc.,CAD,50,61.40,0,-3070.00
2025-01-31,2025-01-31,HQ4K2Z7CAD,Non-registered,Dividend,,,TD,Toronto-Dominion Bank,CAD,,,,61.20
2025-02-03,2025-02-04,HQ9Q1M3USD,Non-registered,Trade,BUY,LONG,MSFT,Microsoft Corp.,USD,8,411.22,0,-3289.76
2025-03-10,2025-03-11,HQ4K2Z7CAD,Non-registered,Trade,SELL,LONG,TD,Toronto-Dominion Bank,CAD,-60,84.30,0,5058.00
2025-04-04,2025-04-07,HQ9Q1M3USD,Non-registered,Trade,SELL,LONG,MSFT,Microsoft Corp.,USD,-8,359.84,0,2878.72
2025-04-21,2025-04-22,HQ9Q1M3USD,Non-registered,Trade,BUY,LONG,MSFT,Microsoft Corp.,USD,5,367.78,0,-1838.90
2025-05-01,2025-05-01,HQ4K2Z7CAD,Non-registered,Dividend,,,ENB,Enbridge Inc.,CAD,,,,47.13
2025-07-15,2025-07-16,HQ5T8V2CAD,TFSA,Trade,BUY,LONG,ENB,Enbridge Inc.,CAD,40,63.10,0,-2524.00
2025-09-16,2025-09-17,HQ4K2Z7CAD,Non-registered,Trade,SELL,LONG,ENB,Enbridge Inc.,CAD,-50,58.75,0,2937.50
2025-10-02,2025-10-03,HQ9Q1M3USD,Non-registered,Trade,SELL,LONG,MSFT,Microsoft Corp.,USD,-5,515.74,0,2578.70
`

/** A Wealthsimple monthly statement CSV (one account, one month of trades). */
export const WS_STATEMENT_CSV = `"date","transaction","description","amount","balance","currency"
"2025-11-03","CONT","Contribution (executed at 2025-11-03)","2500.00","2500.00","CAD"
"2025-11-04","BUY","XIC - iShares Core S&P/TSX Capped Composite Index ETF: Bought 40.0000 shares (executed at 2025-11-04)","-1704.40","795.60","CAD"
"2025-11-12","DIV","XIC - iShares Core S&P/TSX Capped Composite Index ETF: Cash dividend distribution, received on 2025-11-12","6.21","801.81","CAD"
"2025-11-17","BUY","CNR - Canadian National Railway Co.: Bought 5.0000 shares (executed at 2025-11-17)","-683.15","118.66","CAD"
"2025-11-26","SELL","XIC - iShares Core S&P/TSX Capped Composite Index ETF: Sold 15.0000 shares (executed at 2025-11-26)","651.30","769.96","CAD"
`

export const SAMPLES = [
  { id: 'year', title: 'A year of trades', blurb: 'CAD, USD and TFSA accounts, a split, ROC, and two superficial losses (one partial, one lost to a TFSA).' },
  { id: 'activities', title: 'Wealthsimple Activities export', blurb: 'A raw activities CSV run through the importer, dividends and deposits skipped.' },
  { id: 'statement', title: 'Monthly statement CSV', blurb: 'The per-account statement format, with share counts parsed from descriptions.' },
] as const

// Bank of Canada FXUSDCAD for the sample USD trade dates, so samples work offline.
export const SAMPLE_RATES: Rates = {"2024-03-12":1.3499,"2024-06-10":1.3765,"2024-07-02":1.3697,"2025-01-07":1.434,"2025-02-21":1.4207,"2025-08-12":1.3775,"2025-02-03":1.4603,"2025-04-04":1.4216,"2025-04-21":1.382,"2025-10-02":1.3963}
