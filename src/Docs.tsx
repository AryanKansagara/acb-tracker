import { useEffect } from 'react'
import { Brand, Footer, Link, ThemeToggle } from './ui.tsx'

const CRA_CG = 'https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/personal-income/line-12700-capital-gains/calculating-reporting-your-capital-gains-losses.html'
const TI = 'https://taxinterpretations.com/cra/severed-letters/'
const TI_2004 = TI + '2004-0073011e5'
const TI_2005 = TI + '2005-0150811e5'
const TI_2022 = TI + '2022-0940941c6'

/** How the numbers are made and where the reference data comes from. */
export default function Docs() {
  useEffect(() => { document.title = 'How ACB Tracker works: formats, rules and sources' }, [])
  return (
    <div className="docs-page">
      <header className="site-head">
        <Brand />
        <div className="site-head-right">
          <ThemeToggle />
          <Link to="/app" className="btn primary small">Open calculator</Link>
        </div>
      </header>

      <main className="docs">
        <h1 className="display small">How it works, and where the numbers come from</h1>

        <h2>Files it reads</h2>
        <ul>
          <li><b>Wealthsimple Activities export.</b> Both layouts seen in real exports: the older one starting <code>transaction_date,settlement_date,account_id,account_type,activity_type,activity_sub_type,…</code>, and the newer one starting <code>effective_date,effective_time,settlement_date,…</code> with an extra <code>description</code> column. Trades come from <code>activity_type</code> Trade with sub type BUY or SELL, and dividend reinvestments that deliver shares count as buys. Account types such as “Non-registered margin” and “Crypto” go in the non-registered pool. Cash, dividend, interest, cash-back and transfer rows are skipped.</li>
          <li><b>Monthly statement CSV</b> (<code>"date","transaction","description","amount","balance"</code>, sometimes with <code>currency</code>). Share counts and execution dates are read from descriptions like “XIC - iShares…: Bought 40.0000 shares (executed at 2025-11-04)”. The account id and currency come from the file name, e.g. <code>monthly-statement-transactions-HQ4BPK105CAD-2024-09-01.csv</code>.</li>
          <li><b>Option legs and corporate actions</b> (BUYTOOPEN, SELLTOCLOSE, STKREORG, STKDIS, CorporateAction) are never read as share trades. They’re listed as skipped with a warning, because a reorganisation or assignment can change your share count or ACB and needs entering by hand.</li>
          <li>The <b>template</b> from the import screen, and any other CSV through the column-mapping step. Dates like 03/04/2025 that could be either day/month or month/day are rejected rather than guessed.</li>
        </ul>
        <p className="dim">The column layouts and transaction codes were checked against public open-source Wealthsimple converters on GitHub (for example <a href="https://github.com/zimuliu/WealthSimpleCSV2QIF">WealthSimpleCSV2QIF</a>, <a href="https://github.com/jordanozang/wealthsimple-irs">wealthsimple-irs</a> and <a href="https://github.com/rangzen/wealthsimple-csv-to-portfolio-performance">wealthsimple-csv-to-portfolio-performance</a>), checked November 2026. The test fixtures are excerpts written to match those layouts, with made-up values. No real account data is used.</p>

        <h2>The rules it applies</h2>
        <ul>
          <li><b>Average cost across accounts.</b> One ACB pool per security across all your non-registered accounts. Buys add price × quantity plus commission, and sells remove ACB × sold ÷ held. TFSA, RRSP, FHSA and other registered holdings have no ACB, but they still count for the superficial loss rule.</li>
          <li><b>Superficial losses.</b> If you or an affiliated account buys the same security in the 30 days before or after a loss sale and still holds it on day 30, the denied part is the loss × min(S, P, B) ÷ S. S is shares sold, P is shares bought in the window, and B is shares held at the end. The denied amount is added to the ACB of the substitute shares, or lost if they are in a registered account.</li>
          <li><b>Several losing sales, one repurchase.</b> The CRA formula and its examples describe a single sale. When two loss sales have windows that count the same repurchased shares, each sale is still tested on its own, so the same shares can deny both losses and the total can exceed what one combined order would deny. The Act's definition is written per disposition and has no quantity or “used once” wording, and the CRA letters we found (<a href={TI_2004}>2004-0073011E5</a>, <a href={TI_2005}>2005-0150811E5</a>, <a href={TI_2022}>2022-0940941C6</a>) do not say how shared shares are matched. So the numbers are left as computed, and each affected sale carries a warning with both figures: as computed, and with each replacement share matched to one sale only, earliest sale first. Nothing is warned when the two readings agree, for example when enough shares were bought to replace every sale. If this applies to you, ask a tax professional how to report it.</li>
          <li><b>Return of capital</b> lowers ACB. If ACB would go below zero, the excess is a capital gain in that year and ACB resets to $0. <b>Reinvested distributions</b> (T3 box 21 phantom distributions) raise it. <b>Splits and consolidations</b> change the share count, not the ACB.</li>
          <li><b>Tax year by settlement date.</b> Canadian trades settled T+2 until 2024-05-24, and T+1 from 2024-05-27. Settlement skips weekends and the year-end exchange holidays (Christmas, Boxing Day and New Year’s Day, with their weekday observances), because those decide whether a late-December sale falls in this tax year or the next.</li>
          <li><b>Inclusion rate</b> is 50%. The proposed increase to two-thirds was cancelled in March 2025.</li>
        </ul>

        <h2>Exchange rates</h2>
        <p>USD trades use the Bank of Canada daily average USD/CAD rate (series FXUSDCAD) for the trade date. On a weekend or holiday it uses the last business day before. Rates are fetched from the <a href="https://www.bankofcanada.ca/valet/docs">Bank of Canada Valet API</a>, e.g. <code>https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=2025-01-01&amp;end_date=2025-01-31</code>, and cached in your browser. The series starts on 2017-01-03, so older trades need a rate entered by hand. The rates bundled with the samples so they work offline were checked against Valet on 2026-11-13.</p>

        <h2>Samples</h2>
        <p>The sample portfolios are synthetic. The tickers are real and the prices are close to real closes on those dates, but the trades, quantities and account ids are invented.</p>

        <h2>References</h2>
        <ul>
          <li>CRA, <a href={CRA_CG}>Calculating and reporting your capital gains and losses</a></li>
          <li>Income Tax Act, <a href="https://laws-lois.justice.gc.ca/eng/acts/i-3.3/section-54.html">section 54, “superficial loss”</a>, and CRA technical interpretations <a href={TI_2004}>2004-0073011E5</a> and <a href={TI_2005}>2005-0150811E5</a> (the min(S, P, B) / S formula, and B counting every identical share held), and <a href={TI_2022}>2022-0940941C6</a> (CRA roundtable, 7 October 2022), as mirrored by Tax Interpretations. These were read in November 2026.</li>
          <li>CRA guide <a href="https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4037.html">T4037, Capital Gains</a> (ACB, superficial losses, identical properties)</li>
          <li>CRA <a href="https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/5000-s3.html">Schedule 3, Capital Gains (or Losses)</a></li>
          <li>Bank of Canada <a href="https://www.bankofcanada.ca/valet/docs">Valet API documentation</a></li>
        </ul>
      </main>
      <Footer />
    </div>
  )
}
