# ACB Tracker

Adjusted cost base and capital gains calculator for Canadian Wealthsimple investors. It runs entirely in your browser: trades live in local storage, nothing is uploaded, and there is no account.

Live: https://acb-tracker-three.vercel.app (how it works and sources: https://acb-tracker-three.vercel.app/docs)

## The pain

Your broker's book value stops at the edge of one account, but CRA averages cost across all your non-registered accounts. Buy back within 30 days, even in a TFSA, and a loss can be denied. Every USD trade needs its own exchange rate. Most people do this in a spreadsheet in April, or not at all.

## Features

- Imports Wealthsimple Activities exports (older and newer layouts, English and French) and monthly statement CSVs (account and currency read from the file name), a generic template, or any CSV through a column-mapping step. Plus manual entry.
- One ACB pool per security across non-registered accounts. TFSA, RRSP and FHSA holdings are shown, excluded from ACB, and still count for the superficial loss rule.
- Commissions, return of capital, reinvested distributions, splits and consolidations, and negative ACB deemed gains.
- Superficial losses with min(S, P, B) / S pro-rating, split-aware share counts, and denied amounts added to the ACB of substitute shares or flagged as lost when the shares are in a registered account.
- USD converted at the Bank of Canada daily rate for each trade date, cached, rolling weekends and holidays to the prior business day.
- A ledger for every security, Schedule 3 per tax year (by settlement date), plain-language superficial loss explanations, charts, CSV exports and a print report.
- Option legs and corporate actions in an export are flagged, never read as share trades.
- Settlement dates skip weekends and the year-end exchange holidays, so late-December sales land in the right tax year.
- Light and dark themes. Clear all data with one button.

Not tax advice. It estimates from what you enter; check your slips and ask a professional before filing.

## Privacy

The only outside request is a date range sent to the Bank of Canada Valet API for exchange rates. Fonts are self-hosted, there are no analytics, and a content security policy blocks any other destination. There's deliberately no shareable URL, because this is financial data.

## Run locally

```sh
npm install
npm run dev
npm test
npm run build
```

### End-to-end tests

`npm run test:e2e` builds the app and runs the Playwright (Chromium) suite in `e2e/` against that production build, served by `vite preview` on port 4389 (set `E2E_PORT` to change it). The first time, install the browser with `npx playwright install chromium` (add `--with-deps` on a bare Linux box).

The tests never touch the network. Every request that isn't the preview server is blocked and fails the test, and the Bank of Canada API is stubbed per test. An uncaught page error also fails a test. GitHub Actions runs the build, unit tests and these tests on every pull request and push to `main`.
