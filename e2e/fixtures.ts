import { expect, test as base, type Page, type Route } from '@playwright/test'

export const VALET = 'https://www.bankofcanada.ca/valet/**'

type Observation = { d: string; FXUSDCAD: { v: string } }

/** Bank of Canada Valet body for the given USD/CAD rates by date. */
export const valetBody = (rates: Record<string, number>) => ({
  observations: Object.entries(rates).map(([d, v]): Observation => ({ d, FXUSDCAD: { v: String(v) } })),
})

/** Answers every Bank of Canada request with these rates and records the URLs asked for. */
export async function stubValet(page: Page, rates: Record<string, number>) {
  const urls: string[] = []
  await page.route(VALET, (route: Route) => {
    urls.push(route.request().url())
    return route.fulfill({ json: valetBody(rates) })
  })
  return urls
}

/**
 * Every test gets a page that cannot reach the network. Anything that isn't the preview server
 * is aborted and fails the test afterwards, unless the test stubbed it. Uncaught page errors fail it too.
 */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL!).origin
    const blocked: string[] = []
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.route(/^https?:/, (route) => {
      if (new URL(route.request().url()).origin === origin) return route.fallback()
      blocked.push(route.request().url())
      return route.abort()
    })
    await use(page)
    expect(errors, 'uncaught page errors').toEqual([])
    expect(blocked, 'requests that left the app unstubbed').toEqual([])
  },
})

export { expect }

export const TEMPLATE_HEADER = 'date,account,account_type,symbol,name,type,quantity,price,commission,amount,ratio,currency,fx_rate,note'

export const csvFile = (name: string, text: string | Buffer) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })

/** From the empty state: pick a file in the drop zone. */
export async function chooseFile(page: Page, file: ReturnType<typeof csvFile>) {
  await page.locator('input[type=file]').setInputFiles(file)
}

export const stored = (page: Page, key: string) => page.evaluate((k) => localStorage.getItem(k), key)
