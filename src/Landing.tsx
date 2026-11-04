import { useEffect } from 'react'
import { cad, computeAcb } from './engine.ts'
import HeroLedger from './HeroLedger.tsx'
import { HERO_TRADES } from './samples.ts'
import { Brand, Footer, Link, LockIcon, ThemeToggle } from './ui.tsx'

const PAINS = [
  ['wash-peach', 'One pool, every account', 'Hold the same ETF in two non-registered accounts and CRA sees one average cost. A book value that stops at the edge of one account can be wrong on your return.'],
  ['wash-lilac', 'Thirty days, either way', 'Sell at a loss, buy back within 30 days, still hold on day 30, and the loss is denied. Do it in your TFSA or RRSP and that part of the loss is gone for good.'],
  ['wash-butter', 'Every USD leg, its own rate', 'A US stock can gain in dollars and lose in loonies. Buys and sells each convert at the Bank of Canada rate for their own trade date, with weekends rolling to the prior business day.'],
] as const

const FEATURES = [
  ['Tolerant import', 'Wealthsimple Activities exports in English or French, monthly statement CSVs, a plain template, and a column-mapping step for anything else. Re-importing an overlapping export won’t double-count.'],
  ['A row for every change', 'Shares, total ACB, ACB per share and gain or loss after each trade, return of capital, reinvested distribution and split.'],
  ['Superficial losses, explained', 'The min(S, P, B) ÷ S pro-rating shown with your numbers, a 61-day timeline, and where the denied amount went.'],
  ['Schedule 3 by tax year', 'Proceeds, ACB, outlays and net gains per year, grouped by settlement date, ready to copy across.'],
  ['Negative ACB warnings', 'When return of capital pushes ACB under zero, you get a deemed gain for that year and a warning.'],
  ['Export and print', 'Ledger and Schedule 3 as CSV, plus a print-friendly report for your records or your accountant.'],
]

export default function Landing() {
  useEffect(() => { document.title = 'ACB Tracker: adjusted cost base and capital gains for Wealthsimple investors' }, [])
  const sale = computeAcb(HERO_TRADES).securities[0].rows.find((r) => r.denied)!
  const loss = -(sale.gain ?? 0) + sale.denied!

  return (
    <div className="landing">
      <header className="site-head">
        <Brand />
        <div className="site-head-right">
          <ThemeToggle />
          <Link to="/app" className="btn primary small">Open calculator</Link>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-wash" aria-hidden="true" />
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="privacy-pill"><LockIcon /> 100% in your browser. Your trades never leave it.</p>
              <h1>Your cost base, worked out <em>properly.</em></h1>
              <p className="lede">Bring your Wealthsimple exports. Get the adjusted cost base, capital gains and superficial losses you need at tax time, averaged the way CRA expects across every account you own.</p>
              <div className="cta-row">
                <Link to="/app" className="btn primary">Import my trades</Link>
                <Link to="/app?sample=year" className="btn ghost">Try a sample year</Link>
              </div>
            </div>
            <HeroLedger />
          </div>
        </section>

        <section className="band">
          <h2 className="display">Your statement sees one account.<br />CRA sees all of them.</h2>
          <div className="pain-grid">
            {PAINS.map(([wash, title, body]) => (
              <article key={title} className={`pain ${wash}`}>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="band example">
          <div>
            <span className="eyebrow">From the ledger above</span>
            <h2 className="display">A {cad(loss)} loss. Only {cad(-sale.gain!)} of it is yours to claim this year.</h2>
          </div>
          <ol className="steps">
            <li><b>Sold {sale.quantity} shares</b> on April 7 for a {cad(loss)} loss.</li>
            <li><b>Bought 80 back</b> on April 22, inside the 30-day window, and still held them on day 30.</li>
            <li><b>Denied: {cad(loss)} × 80 ÷ 120 = {cad(sale.denied!)}.</b> It isn’t gone. It’s added to your ACB, so it comes back when you finally sell.</li>
          </ol>
        </section>

        <section className="band">
          <h2 className="display">Built for tax season, not for a demo.</h2>
          <div className="feature-grid">
            {FEATURES.map(([title, body]) => (
              <article key={title}>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="privacy-band">
          <div>
            <h2 className="display">Your trades never leave this browser.</h2>
            <p>There’s no server, no account, no analytics and no shareable link. Trades stay in this browser’s local storage until you press “Clear all data”. Fonts are served from this site.</p>
            <p>The one outside request goes to the Bank of Canada for USD/CAD rates, and it carries a date range, nothing else. A content security policy tells your browser to block every other destination. Open the network tab and check.</p>
          </div>
          <Link to="/app" className="btn invert">Open the calculator</Link>
        </section>

        <section className="band limits">
          <h2 className="display small">What it doesn’t do</h2>
          <ul>
            <li>Return of capital and reinvested distributions come from your T3 slips, so you enter those by hand. They aren’t in a trade export.</li>
            <li>Mergers, spin-offs, options and a spouse’s purchases aren’t modelled.</li>
            <li>USD rates start in 2017, when the Bank of Canada series begins. Older trades need a manual rate.</li>
          </ul>
        </section>
      </main>
      <Footer />
    </div>
  )
}
