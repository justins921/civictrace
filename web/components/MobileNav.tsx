'use client'

/* The mobile menu.
 *
 * This was built on <details>/<summary> first, for the free no-JS behaviour.
 * It tested clean in Chromium and in WebKit iPhone emulation and still misbehaved
 * on a real phone, so it is now an explicit button with explicit state. Native
 * <details> toggling plus React's view of it is two sources of truth for one
 * boolean, and on a touch screen — where a tap can produce a touch event and a
 * synthesised click — they can disagree. One source of truth, one handler.
 *
 * Three deliberate choices, each fixing a way mobile menus break:
 *
 *   - Closing on an outside tap goes through a real full-screen scrim element,
 *     not a document listener. iOS only synthesises mouse events over elements
 *     it considers clickable, so "tap the background to close" silently fails
 *     on plain body text. A scrim is always clickable.
 *   - Page scroll is locked while the menu is open. The panel hangs off the
 *     header, so without this you can scroll the header away and leave an open
 *     menu somewhere above the viewport with no visible way to shut it.
 *   - The panel carries the `hidden` attribute as well as a CSS rule. Chromium
 *     does not hide an absolutely positioned child of a closed <details>, and
 *     the equivalent mistake here would leave ten links in the tab order behind
 *     a closed menu.
 *
 * With scripting off the button is inert, so a <noscript> copy of the same links
 * renders in its place. The site stays navigable — that matters more here than
 * on most sites, because this is a public-records tool and people read it on
 * whatever device they have.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ENTITY_NAV, SUB_NAV } from '@/components/nav'

function Panel({ pathname }: { pathname: string }) {
  return (
    <>
      <nav aria-label="Browse by type">
        {ENTITY_NAV.map(({ href, label, Icon, blurb }) => (
          <Link key={href} href={href} className="mnav-item"
            aria-current={pathname === href ? 'page' : undefined}>
            <span className="mnav-ico"><Icon size={24} /></span>
            <span className="mnav-text">
              <b>{label}</b>
              <em>{blurb}</em>
            </span>
          </Link>
        ))}
      </nav>
      <div className="mnav-sub">
        {SUB_NAV.map(({ href, label }) => (
          <Link key={label} href={href}>{label}</Link>
        ))}
      </div>
    </>
  )
}

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()

  const close = useCallback((refocus = false) => {
    setOpen(false)
    if (refocus) btnRef.current?.focus()
  }, [])

  // Next navigates without a document load, so the panel would otherwise stay
  // open over the page it just took you to.
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true) }
    const onResize = () => { if (window.innerWidth > 860) setOpen(false) }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)

    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      document.body.style.overflow = prev
    }
  }, [open, close])

  return (
    <div className="mnav-wrap">
      <button
        ref={btnRef}
        type="button"
        className="burger"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen(v => !v)}
      >
        <span className="burger-in">
          <span className={`burger-box${open ? ' is-open' : ''}`} aria-hidden>
            <i /><i /><i />
          </span>
          <span className="burger-word">{open ? 'Close' : 'Menu'}</span>
        </span>
      </button>

      {open && (
        <div className="mnav-scrim" onClick={() => close()} aria-hidden />
      )}

      <div className="mnav" id="mobile-nav" hidden={!open}>
        <Panel pathname={pathname} />
      </div>

      <noscript>
        <div className="mnav mnav-noscript">
          <Panel pathname={pathname} />
        </div>
      </noscript>
    </div>
  )
}
