import { chooseFile, csvFile, expect, stored, stubValet, TEMPLATE_HEADER, test } from './fixtures.ts'

const TXS = 'acb.txs.v1'
const FX = 'acb.fx.v1'

const CAD_CSV = [
  TEMPLATE_HEADER,
  '2025-03-03,Personal,Non-registered,ZZCAD,Synthetic CAD fund,buy,100,10,5,,,CAD,,',
  '2025-06-16,Personal,Non-registered,ZZCAD,,sell,40,12,5,,,CAD,,',
].join('\n')

const USD_CSV = [
  TEMPLATE_HEADER,
  '2025-03-03,Personal USD,Non-registered,ZZUSD,Synthetic USD fund,buy,10,100,0,,,USD,,',
  '2025-06-16,Personal USD,Non-registered,ZZUSD,,sell,10,120,0,,,USD,,',
].join('\n')

// 100 bought at $20, then $10 sales, then 50 bought back: one order of 100, or two orders of 50 on consecutive days.
const SHARED_BUY = '2026-01-05,Personal,Non-registered,ZZSHARE,Synthetic Corp,buy,100,20,0,,,CAD,,'
const SHARED_REBUY = '2026-06-10,Personal,Non-registered,ZZSHARE,,buy,50,10,0,,,CAD,,'
const ONE_ORDER_CSV = [TEMPLATE_HEADER, SHARED_BUY, '2026-06-01,Personal,Non-registered,ZZSHARE,,sell,100,10,0,,,CAD,,', SHARED_REBUY].join('\n')
const TWO_ORDERS_CSV = [TEMPLATE_HEADER, SHARED_BUY, '2026-06-01,Personal,Non-registered,ZZSHARE,,sell,50,10,0,,,CAD,,', '2026-06-02,Personal,Non-registered,ZZSHARE,,sell,50,10,0,,,CAD,,', SHARED_REBUY].join('\n')

const RATES = { '2025-03-03': 1.3, '2025-06-16': 1.4 }

const importButton = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^Import \d+ trades?$/ })

async function importFile(page: import('@playwright/test').Page, name: string, text: string) {
  await page.goto('/app')
  await chooseFile(page, csvFile(name, text))
  await expect(page.getByRole('heading', { name: 'Review import' })).toBeVisible()
  await importButton(page).click()
  await expect(page.getByRole('heading', { name: 'Start with your own trades.' })).toBeHidden()
}

const tile = (page: import('@playwright/test').Page, name: string) => page.locator('.tile', { has: page.getByText(name, { exact: true }) })

test.describe('sample data', () => {
  test('a security ledger shows its ACB', async ({ page }) => {
    await page.goto('/app?sample=year')
    await expect(page.getByText('Sample year loaded.').first()).toBeAttached()
    await expect(tile(page, 'ACB of shares held').locator('dd')).toHaveText('$23,371.10')

    await page.getByRole('button', { name: 'XEQT', exact: true }).first().click()
    const summary = page.locator('.panel-head .mini').first()
    await expect(summary.locator('div', { hasText: 'Shares' }).locator('dd')).toHaveText('410')
    await expect(summary.locator('div', { hasText: 'ACB' }).first().locator('dd')).toHaveText('$12,333.24')
    await expect(summary.locator('div', { hasText: 'Per share' }).locator('dd')).toHaveText('$30.08')

    // The last ledger row carries the same running total.
    const last = page.locator('table.ledger tbody').last().locator('tr').first()
    await expect(last.locator('td.num').nth(5)).toHaveText('$12,333.24')
  })

  test('superficial losses are explained, including the part lost to a TFSA', async ({ page }) => {
    await page.goto('/app?sample=year')
    await page.getByRole('button', { name: /^Superficial losses/ }).click()
    const articles = page.locator('article.sl')
    await expect(articles).toHaveCount(2)

    const shop = articles.filter({ hasText: 'SHOP.TO, sold 2024-08-06' })
    await expect(shop).toContainText('$856.00 loss, $321.00 still claimable')
    await expect(shop).toContainText('Denied loss = $856.00 × min(40, 25, 25) / 40 = $535.00.')
    await expect(shop).toContainText('lost permanently')

    const xeqt = articles.filter({ hasText: 'XEQT, sold 2025-04-07' })
    await expect(xeqt).toContainText('Denied loss = $204.19 × min(120, 80, 510) / 120 = $136.12.')
    await expect(xeqt).toContainText('$136.12 is added to the ACB of your remaining XEQT shares')

    // The same explanation sits under the sale in the ledger.
    await xeqt.getByRole('button', { name: 'Open ledger' }).click()
    await expect(page.locator('tr.note').first()).toContainText('Denied loss = $204.19 × min(120, 80, 510) / 120 = $136.12.')
  })

  test('Schedule 3 for the sample year', async ({ page }) => {
    await page.goto('/app?sample=year')
    await page.getByRole('button', { name: 'Schedule 3', exact: true }).click()
    await expect(page.getByRole('button', { name: '2025', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(tile(page, 'Net gain or loss').locator('dd')).toHaveText('+$9,239.40')
    await expect(tile(page, 'Taxable at 50%').locator('dd')).toHaveText('$4,619.70')
  })

  test('the landing page leads into the sample', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Try a sample year' }).first().click()
    await expect(page).toHaveURL(/\/app$/)
    await expect(page.getByRole('button', { name: 'Ledger', exact: true })).toBeVisible()
    await expect(tile(page, 'ACB of shares held').locator('dd')).toHaveText('$23,371.10')
  })

  test('the docs page loads', async ({ page }) => {
    await page.goto('/docs')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('losing sales that share replacement shares', () => {
  test('one order of 100 is denied $500 and carries no warning', async ({ page }) => {
    await importFile(page, 'synthetic-one-order.csv', ONE_ORDER_CSV)
    await expect(tile(page, 'Denied as superficial, all years').locator('dd')).toHaveText('$500.00')
    await expect(page.locator('.warnings')).toHaveCount(0)
    await page.getByRole('button', { name: /^Superficial losses/ }).click()
    await expect(page.locator('article.sl')).toHaveCount(1)
    await expect(page.locator('article.sl')).not.toContainText('Shared replacement shares')
    await expect(page.locator('.formula .alt')).toHaveCount(0)
  })

  test('two orders of 50 keep the figures, warn, and show both readings', async ({ page }) => {
    await importFile(page, 'synthetic-two-orders.csv', TWO_ORDERS_CSV)
    // Numbers are exactly what each sale tested on its own gives.
    await expect(tile(page, 'Denied as superficial, all years').locator('dd')).toHaveText('$1,000.00')
    await expect(tile(page, 'ACB of shares held').locator('dd')).toHaveText('$1,500.00')

    const warnings = page.locator('.warnings')
    await expect(warnings).toContainText('2 warnings to check')
    await warnings.locator('summary').click()
    await expect(warnings).toContainText('Replacement shares are shared with the loss sale on 2026-06-02. Denied $1,000.00 in total as computed, or $500.00 if each replacement share is matched to one sale only.')

    await page.getByRole('button', { name: /^Superficial losses/ }).click()
    const articles = page.locator('article.sl')
    await expect(articles).toHaveCount(2)
    const second = articles.filter({ hasText: 'ZZSHARE, sold 2026-06-02' })
    await expect(second).toContainText('$500.00 loss, $0.00 still claimable')
    await expect(second.locator('.formula .alt')).toContainText('If matched once$0.00')
    await expect(second).toContainText('Shared replacement shares: the shares bought on 2026-06-10 also count for the loss sale on 2026-06-01.')
    await expect(second).toContainText("The Income Tax Act and CRA letters don't say which applies")
    await expect(articles.filter({ hasText: 'ZZSHARE, sold 2026-06-01' }).locator('.formula .alt')).toContainText('If matched once$500.00')

    // The same text sits under the sale in the ledger, next to the warning.
    await second.getByRole('button', { name: 'Open ledger' }).click()
    await expect(page.locator('tr.note').filter({ hasText: 'Shared replacement shares' })).toHaveCount(2)
    await expect(page.locator('tr.note.warn')).toHaveCount(2)
  })

  test('the docs say what the sources settle and what they do not', async ({ page }) => {
    await page.goto('/docs')
    await expect(page.getByText('Several losing sales, one repurchase.')).toBeVisible()
    await expect(page.getByRole('link', { name: '2004-0073011E5' }).first()).toHaveAttribute('href', /taxinterpretations\.com/)
    await expect(page.getByText('Not tax advice.')).toBeVisible()
  })
})

test.describe('importing a CSV', () => {
  test('CAD file: Schedule 3 matches a hand calculation', async ({ page }) => {
    await importFile(page, 'synthetic-cad.csv', CAD_CSV)
    await expect(page.locator('.toast')).toHaveText('Imported 2 trades.')

    // ACB of the 40 sold = (100 × 10 + 5) × 40 / 100 = 402. Gain = 480 - 402 - 5 = 73.
    await page.getByRole('button', { name: 'Schedule 3', exact: true }).click()
    await expect(tile(page, 'Proceeds').locator('dd')).toHaveText('$480.00')
    await expect(tile(page, 'ACB + outlays').locator('dd')).toHaveText('$407.00')
    await expect(tile(page, 'Net gain or loss').locator('dd')).toHaveText('+$73.00')
    const line = page.getByRole('region', { name: 'Schedule 3 for 2025' }).locator('tbody tr')
    await expect(line).toHaveCount(1)
    await expect(line).toContainText('ZZCAD')
    await expect(line).toContainText('2025-06-17') // settled T+1

    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await expect(page.getByRole('button', { name: 'ZZCAD', exact: true })).toBeVisible()
    expect(await stored(page, FX)).toBeNull() // nothing in CAD needs a rate
  })

  test('USD file: rates come from the stubbed Bank of Canada', async ({ page }) => {
    const asked = await stubValet(page, RATES)
    await importFile(page, 'synthetic-usd.csv', USD_CSV)
    await expect(page.locator('.callout.warn')).toBeHidden()

    // The only outside request: one date range, ten days of lead-in for weekends and holidays.
    expect(asked).toEqual(['https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=2025-02-21&end_date=2025-06-16'])

    // ACB = 10 × 100 × 1.30 = 1,300. Proceeds = 10 × 120 × 1.40 = 1,680. Gain = 380.
    await page.getByRole('button', { name: 'Schedule 3', exact: true }).click()
    await expect(tile(page, 'Proceeds').locator('dd')).toHaveText('$1,680.00')
    await expect(tile(page, 'ACB + outlays').locator('dd')).toHaveText('$1,300.00')
    await expect(tile(page, 'Net gain or loss').locator('dd')).toHaveText('+$380.00')

    await page.getByRole('button', { name: 'Ledger', exact: true }).click()
    const rows = page.locator('table.ledger tbody tr:not(.note)')
    await expect(rows.nth(0)).toContainText('1.3000')
    await expect(rows.nth(1)).toContainText('1.4000')
  })

  test('pasted text imports the same way as a file', async ({ page }) => {
    await page.goto('/app')
    await page.getByText('Paste CSV text instead').click()
    await page.getByLabel('CSV text').fill(CAD_CSV)
    await page.getByRole('button', { name: 'Read this CSV' }).click()
    await expect(page.getByRole('heading', { name: 'Review import' })).toBeVisible()
    await expect(page.getByText('ACB Tracker template')).toBeVisible()
    await importButton(page).click()
    await expect(page.locator('.toast')).toHaveText('Imported 2 trades.')
  })

  test('importing the same file twice leaves the duplicates out', async ({ page }) => {
    await importFile(page, 'synthetic-cad.csv', CAD_CSV)
    await page.getByRole('button', { name: 'Import CSV' }).click()
    await chooseFile(page, csvFile('synthetic-cad.csv', CAD_CSV))
    await expect(page.getByText('Every trade in this file is already saved.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import 0 trades' })).toBeDisabled()
  })
})

test.describe('exchange rate outage', () => {
  test('is shown honestly, and recovers when the Bank of Canada does', async ({ page }) => {
    let up = false
    const asked: string[] = []
    await page.route('https://www.bankofcanada.ca/valet/**', (route) => {
      asked.push(route.request().url())
      return up ? route.fulfill({ json: { observations: Object.entries(RATES).map(([d, v]) => ({ d, FXUSDCAD: { v: String(v) } })) } }) : route.fulfill({ status: 503, body: 'down' })
    })
    await importFile(page, 'synthetic-usd.csv', USD_CSV)

    const warning = page.getByRole('alert').filter({ hasText: 'no exchange rate' })
    await expect(warning).toContainText('2 USD trades have no exchange rate and are counted at 1.0')
    await expect(warning).toContainText('the numbers below are wrong until that’s fixed')
    await expect(warning).toContainText('We couldn’t reach the Bank of Canada.')
    expect(await stored(page, FX)).toBeNull() // a failed lookup caches nothing

    // The ledger says "none" rather than inventing a rate.
    await page.getByRole('button', { name: 'Ledger', exact: true }).click()
    await expect(page.locator('table.ledger td.num .neg', { hasText: 'none' })).toHaveCount(2)

    up = true
    await warning.getByRole('button', { name: 'Try again' }).click()
    await expect(warning).toBeHidden()
    await expect(page.locator('table.ledger tbody tr:not(.note)').nth(0)).toContainText('1.3000')
    expect(asked).toHaveLength(2)
  })

  test('a dropped connection is reported the same way', async ({ page }) => {
    await page.route('https://www.bankofcanada.ca/valet/**', (route) => route.abort('connectionrefused'))
    await importFile(page, 'synthetic-usd.csv', USD_CSV)
    await expect(page.getByRole('alert').filter({ hasText: 'no exchange rate' })).toContainText('We couldn’t reach the Bank of Canada.')
  })

  test('a reply with no usable rates is not mistaken for success', async ({ page }) => {
    await page.route('https://www.bankofcanada.ca/valet/**', (route) => route.fulfill({ json: { observations: [{ d: '2025-03-03', FXUSDCAD: { v: 'n/a' } }] } }))
    await importFile(page, 'synthetic-usd.csv', USD_CSV)
    await expect(page.getByRole('alert').filter({ hasText: 'no exchange rate' })).toContainText('2 USD trades have no exchange rate')
  })
})

test.describe('clear all', () => {
  test('removes trades and cached rates, and a reload stays empty', async ({ page }) => {
    await stubValet(page, RATES)
    await importFile(page, 'synthetic-usd.csv', USD_CSV)
    expect(await stored(page, TXS)).not.toBeNull()
    expect(await stored(page, FX)).not.toBeNull()

    await page.getByRole('button', { name: 'Clear all data' }).click()
    const dialog = page.getByRole('dialog', { name: 'Clear all data?' })
    await expect(dialog).toContainText('deletes all 2 trades and cached exchange rates')
    await dialog.getByRole('button', { name: 'Keep my data' }).click()
    expect(await stored(page, TXS)).not.toBeNull() // cancelling deletes nothing

    await page.getByRole('button', { name: 'Clear all data' }).click()
    await page.getByRole('button', { name: 'Delete everything' }).click()
    await expect(page.getByRole('heading', { name: 'Start with your own trades.' })).toBeVisible()
    expect(await stored(page, TXS)).toBeNull()
    expect(await stored(page, FX)).toBeNull()

    await page.reload()
    await expect(page.getByRole('heading', { name: 'Start with your own trades.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Clear all data' })).toHaveCount(0)
  })
})

test.describe('files that are not trade exports', () => {
  const unusable = async (page: import('@playwright/test').Page, file: ReturnType<typeof csvFile>) => {
    await page.goto('/app')
    await chooseFile(page, file)
    await expect(page.getByRole('heading', { name: 'Review import' })).toBeVisible()
    // Never an import button that could succeed with nothing behind it.
    await expect(page.getByRole('button', { name: 'Import 0 trades' })).toBeDisabled()
    expect(await stored(page, TXS)).toBeNull()
  }
  const stillUsable = async (page: import('@playwright/test').Page) => {
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: 'Review import' })).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Start with your own trades.' })).toBeVisible()
    await page.getByRole('button', { name: /^A year of trades/ }).click()
    await expect(tile(page, 'ACB of shares held').locator('dd')).toHaveText('$23,371.10')
  }

  test('plain text with a .csv name', async ({ page }) => {
    await unusable(page, csvFile('notes.csv', 'hello world\nthis is not a trades file'))
    await expect(page.getByText('Unrecognized format')).toBeVisible()
    await expect(page.getByText('We didn’t recognize this file. Tell us which column holds what.')).toBeVisible()
    await expect(page.getByText('No trades found yet.')).toBeVisible()
    await stillUsable(page)
  })

  test('an empty file', async ({ page }) => {
    await unusable(page, csvFile('empty.csv', ''))
    await expect(page.getByText('This file has no data rows.')).toBeVisible()
    await stillUsable(page)
  })

  test('binary bytes that are not text', async ({ page }) => {
    await unusable(page, csvFile('photo.csv', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xfe, 0xfe, 0x80, 0x81])))
    await expect(page.getByText('Unrecognized format')).toBeVisible()
    await stillUsable(page)
  })

  test('a JSON file', async ({ page }) => {
    await unusable(page, csvFile('data.csv', '{"trades":[{"symbol":"XEQT","qty":10}]}'))
    await expect(page.getByText('Unrecognized format')).toBeVisible()
    await stillUsable(page)
  })

  test('the right headers with no rows', async ({ page }) => {
    await unusable(page, csvFile('template.csv', TEMPLATE_HEADER))
    await expect(page.getByText('ACB Tracker template')).toBeVisible()
    await expect(page.getByText('This file has no data rows.')).toBeVisible()
  })

  test('rows whose dates cannot be read are skipped and named', async ({ page }) => {
    await unusable(page, csvFile('bad-dates.csv', [TEMPLATE_HEADER, 'last tuesday,Personal,Non-registered,ZZCAD,,buy,100,10,0,,,CAD,,', '31/31/2025,Personal,Non-registered,ZZCAD,,buy,5,10,0,,,CAD,,'].join('\n')))
    await expect(page.getByText('2 rows skipped')).toBeVisible()
    await page.getByText('2 rows skipped').click()
    await expect(page.getByText('unreadable date "last tuesday"')).toBeVisible()
    await expect(page.getByText('unreadable date "31/31/2025"')).toBeVisible()
  })

  test('option legs are skipped with a warning, not read as share trades', async ({ page }) => {
    await page.goto('/app')
    const csv = [TEMPLATE_HEADER, '2025-03-03,Personal,Non-registered,ZZCAD,,buy,100,10,0,,,CAD,,', '2025-03-04,Personal,Non-registered,ZZCAD,,BUY_TO_OPEN,1,2,0,,,CAD,,'].join('\n')
    await chooseFile(page, csvFile('with-option.csv', csv))
    await expect(page.getByText('Some skipped rows are options or corporate actions.')).toBeVisible()
    await expect(importButton(page)).toHaveText('Import 1 trade')
  })
})

test.describe('persistence', () => {
  test('imported trades and cached rates survive a reload without asking the network again', async ({ page }) => {
    const asked = await stubValet(page, RATES)
    await importFile(page, 'synthetic-usd.csv', USD_CSV)
    await page.getByRole('button', { name: 'Schedule 3', exact: true }).click()
    await expect(tile(page, 'Net gain or loss').locator('dd')).toHaveText('+$380.00')
    expect(asked).toHaveLength(1)

    await page.reload()
    await page.getByRole('button', { name: 'Schedule 3', exact: true }).click()
    await expect(tile(page, 'Net gain or loss').locator('dd')).toHaveText('+$380.00')
    await expect(page.getByText('2 trades saved in this browser’s local storage')).toBeVisible()
    expect(asked).toHaveLength(1)
  })

  test('a trade added by hand survives a reload, and so does a deletion', async ({ page }) => {
    await page.goto('/app?sample=year')
    await expect(page.getByRole('button', { name: 'Add trade' })).toBeVisible()
    await page.getByRole('button', { name: 'Add trade' }).click()
    const form = page.getByRole('dialog', { name: 'Add a trade' })
    await form.getByLabel('Trade date').fill('2025-07-07')
    await form.getByLabel('Symbol').fill('zzman')
    await form.getByLabel('Quantity').fill('10')
    await form.getByLabel('Price per share').fill('20')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: 'ZZMAN', exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('button', { name: 'ZZMAN', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Trades', exact: true }).click()
    await page.getByRole('button', { name: 'Delete ZZMAN 2025-07-07' }).click()
    await expect(page.getByRole('button', { name: 'Delete ZZMAN 2025-07-07' })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: 'ZZMAN', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'XEQT', exact: true })).toBeVisible()
  })

  test('the form rejects a trade with no quantity and saves nothing', async ({ page }) => {
    await page.goto('/app?sample=year')
    await page.getByRole('button', { name: 'Add trade' }).click()
    const form = page.getByRole('dialog', { name: 'Add a trade' })
    await form.getByLabel('Trade date').fill('2025-07-07')
    await form.getByLabel('Symbol').fill('ZZBAD')
    await form.getByRole('button', { name: 'Save' }).click()
    await expect(form.getByRole('alert')).toHaveText('Quantity must be more than zero.')
  })

  test('the theme choice survives a reload', async ({ page }) => {
    await page.goto('/app?sample=year')
    await page.getByRole('button', { name: 'Switch to dark mode' }).click()
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark')
  })
})
