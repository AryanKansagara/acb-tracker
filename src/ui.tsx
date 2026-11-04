import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'
import { cad } from './engine.ts'

// ---------- router ----------
const subscribe = (fn: () => void) => {
  window.addEventListener('popstate', fn)
  return () => window.removeEventListener('popstate', fn)
}
export const usePath = () => useSyncExternalStore(subscribe, () => location.pathname)

export function navigate(to: string) {
  history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    navigate(to)
  }
  return <a href={to} className={className} onClick={onClick}>{children}</a>
}

// ---------- chrome ----------
export function ThemeToggle() {
  const [mode, setMode] = useState(() => document.documentElement.dataset.themeMode ?? 'light')
  const next = mode === 'dark' ? 'light' : 'dark'
  return (
    <button
      className="icon-btn"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.themeMode = next
        localStorage.setItem('themeMode', next)
        setMode(next)
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        {mode === 'dark' ? (
          <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7" strokeLinecap="round" /></>
        ) : (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  )
}

export const Brand = () => (
  <Link to="/" className="brand">
    <span className="monogram" aria-hidden="true">AT</span>
    <span>ACB Tracker</span>
  </Link>
)

export const LockIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5 7V5a3 3 0 0 1 6 0v2" />
  </svg>
)

export const Disclaimer = () => (
  <p className="disclaimer">
    <strong>Not tax advice.</strong> ACB Tracker estimates from the trades you give it and nothing else. It can't see trades elsewhere,
    purchases by a spouse or a corporation you control, mergers, spin-offs or options. Check the results against your T3 and T5008 slips,
    and talk to a tax professional before you file.
  </p>
)

export const Footer = () => (
  <footer className="footer">
    <Disclaimer />
    <p>Built by Aryan Kansagara. Independent project, not affiliated with Wealthsimple.</p>
  </footer>
)

export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal()
  }, [])
  return (
    <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} onClose={onClose} aria-labelledby="modal-title">
      <header className="modal-head">
        <h2 id="modal-title">{title}</h2>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 16 16" width="14" height="14" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg>
        </button>
      </header>
      {children}
    </dialog>
  )
}

// ---------- formatting ----------
export const shares = (n: number) => n.toLocaleString('en-CA', { maximumFractionDigits: 4 })
export const signed = (n: number) => (n > 0.004 ? '+' : '') + cad(n)
export const Gain = ({ v }: { v: number | undefined }) =>
  v === undefined ? <span className="dim">–</span> : <span className={v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : ''}>{signed(v)}</span>

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Tweens a number toward its target; the hero's big figures roll instead of jumping. */
export function useTween(target: number, ms = 500) {
  const [v, setV] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    if (prefersReducedMotion()) return setV(target)
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const cur = a + (target - a) * (1 - (1 - p) ** 3)
      from.current = cur
      setV(cur)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

export function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
