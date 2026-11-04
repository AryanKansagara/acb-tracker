// Bank of Canada USD/CAD daily average (Valet API, CORS-enabled, no key).
import { addDays, type FxLookup } from './engine.ts'

export type Rates = Record<string, number>
const KEY = 'acb.fx.v1'
export const FX_SERIES_START = '2017-01-03' // FXUSDCAD begins here; older trades need a manual rate

/** Rate for the date, or the most recent prior business day (weekends, holidays). */
export function rateOn(rates: Rates, date: string): { rate: number; date: string } | undefined {
  for (let i = 0; i < 10; i++) {
    const d = addDays(date, -i)
    if (rates[d]) return { rate: rates[d], date: d }
  }
  return undefined
}

export const lookupFrom = (rates: Rates): FxLookup => (date) => rateOn(rates, date)

export function parseValet(json: unknown): Rates {
  const out: Rates = {}
  const obs = (json as { observations?: { d: string; FXUSDCAD?: { v: string } }[] }).observations ?? []
  for (const o of obs) {
    const v = Number(o.FXUSDCAD?.v)
    if (o.d && v > 0) out[o.d] = v
  }
  return out
}

export function loadCachedRates(): Rates {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Rates
  } catch {
    return {}
  }
}

export function saveRates(r: Rates) {
  localStorage.setItem(KEY, JSON.stringify(r))
}

/**
 * Dates never asked of the Bank of Canada. A prior-day hit doesn't count: with a partial cache,
 * Monday would quietly take Friday's rate. Known non-publication days are stored as 0 by withGaps.
 */
export function uncovered(rates: Rates, dates: string[]): string[] {
  return dates.filter((d) => d >= FX_SERIES_START && !(d in rates))
}

/** Marks days in a fetched range with no observation as 0, except the last two (maybe unpublished yet). */
export function withGaps(fetched: Rates, start: string, end: string, today: string): Rates {
  const out = { ...fetched }
  const last = addDays(today, -2)
  for (let d = start; d <= end && d <= last; d = addDays(d, 1)) if (!(d in out)) out[d] = 0
  return out
}

export const clearCachedRates = () => localStorage.removeItem(KEY)

export async function fetchRates(dates: string[], signal?: AbortSignal): Promise<Rates> {
  if (!dates.length) return {}
  const sorted = [...dates].sort()
  const start = addDays(sorted[0], -10)
  const end = sorted[sorted.length - 1]
  const url = `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=${start}&end_date=${end}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Bank of Canada returned ${res.status}`)
  return withGaps(parseValet(await res.json()), start, end, new Date().toISOString().slice(0, 10))
}
