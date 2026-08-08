import { createClient } from '@supabase/supabase-js'

/* These are publishable values by design — they are compiled into the client
   bundle either way. Safety here comes from RLS: the schema grants SELECT only,
   and the database contains nothing but republished public records. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://vzvtlwfvncwwtzntndmy.supabase.co'
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_962AMHB-5EccIqag-UyHEQ_hl5Rd4_V'

/* Read-only public key against a read-only schema. There is no private data in
   this database — it is entirely republished government records. */
export const db = createClient(url, key, {
  db: { schema: 'civictrace' },
  auth: { persistSession: false },
})

/* H1. The corrections form writes through a SECURITY DEFINER function, and
   EXECUTE on it is (for now) granted to `anon` — the role behind the key above,
   which ships in the browser bundle. So the report queue is writable by anyone
   who can POST, honeypot or no honeypot.

   The fix has two halves and they land in either order safely. This is the code
   half: when SUPABASE_SERVICE_ROLE_KEY is set — server-side only, no
   NEXT_PUBLIC_ prefix, never bundled — writes go through a privileged client
   and the grant to `anon` can be revoked. Until it is set, this returns the
   ordinary client and the form keeps working exactly as it does today.

   Server-only by construction: importing this into a client component would
   fail the build, because `db` is what components import and this is not it. */
export function writeClient() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) return db
  return createClient(url, secret, {
    db: { schema: 'civictrace' },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** True when the privileged path is live — the contact form logs this so a
 *  missing environment variable is visible rather than silently degrading. */
export const hasWriteKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)

export const money = (n: number | null | undefined) =>
  '$' + Math.round(Number(n || 0)).toLocaleString('en-US')

export const shortMoney = (n: number | null | undefined) => {
  const v = Number(n || 0)
  if (v >= 1_000_000_000) return '$' + (v / 1e9).toFixed(1) + 'B'
  if (v >= 1_000_000) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (v >= 1_000) return '$' + Math.round(v / 1e3) + 'K'
  return money(v)
}

export const partyLetter = (p?: string | null) =>
  p === 'Republican' || p === 'R' ? 'R' : p === 'Democrat' || p === 'D' ? 'D' : 'I'

export const officeLine = (m: { chamber?: string | null; district?: string | null }) =>
  m.chamber === 'sen' ? 'U.S. Senate' : `U.S. House, WI-${String(m.district || '').padStart(2, '0')}`

export const isYes = (p?: string | null) => /^(Yea|Aye|Yes)$/i.test(p || '')

/* Five states, named for what was observed rather than for how interesting it
   is. Ordering matters: this is also the sort key everywhere.

   "Notable overlap" and "Some overlap" are gone. They read as verdicts — a
   member who voted *against* the industry that funds them collected the same
   "Notable overlap" badge as one who voted with it, and the badge is the part
   that gets quoted. These names state the two facts the record actually
   supports: how the member voted relative to their own party, and whether the
   industry's money sits mostly on one pole of its own axis. */
export const LABELS = [
  'Crossed party, one-sided industry money',
  'Crossed party, industry money present',
  'Contested vote, one-sided industry money',
  'Contested vote, industry money present',
  'Party-line vote — low signal',
  'Near-unanimous vote — no signal',
] as const

/* Two labels, not one, for a member who broke from their own party.
   "One-sided" is a claim about the industry's money, and it is only checkable
   for the three sectors that have a declared two-sided axis. The engine used to
   treat "we never looked" as "one-sided", which meant the strongest badge on
   the site asserted something the record did not support. Where the axis is
   unavailable or inconclusive, the party divergence is still a real and
   documented fact, so it gets its own label rather than being quietly demoted
   to the same bucket as a member who voted with their party. */
export const NO_SIGNAL_LABELS: readonly string[] = [LABELS[4], LABELS[5]]

export function labelClass(label?: string | null) {
  /* Tolerates undefined on purpose. A view column that is briefly absent —
     PostgREST caches the schema and reloads it after DDL, so `select('*')` can
     return yesterday's column set for a few seconds after a migration — used
     to take the whole page down with "cannot read properties of undefined".
     A missing label should render as the neutral badge, not a 500. */
  label = label || ''
  if (label.startsWith('Crossed party, one-sided')) return { badge: 'b-note', verdict: 'v-note', angle: 62 }
  if (label.startsWith('Crossed party')) return { badge: 'b-note', verdict: 'v-note', angle: 48 }
  if (label.startsWith('Contested vote, one-sided')) return { badge: 'b-note', verdict: 'v-note', angle: 40 }
  if (label.startsWith('Contested vote')) return { badge: 'b-some', verdict: 'v-some', angle: 20 }
  if (label.startsWith('Party-line')) return { badge: 'b-low', verdict: 'v-low', angle: -30 }
  return { badge: 'b-low', verdict: 'v-none', angle: -66 }
}

/* The site's headline honesty statistic, defined once.
 *
 * It was previously written out by hand in three places and disagreed in all
 * three: /trails summed the wrong two labels and printed 61%, a member page
 * hardcoded 87%, and the true figure was 89%. A number this project quotes as
 * the point of the whole exercise cannot be a literal typed into JSX. */
export function noSignalShare(counts: Record<string, number>, total: number): number {
  if (!total) return 0
  const n = NO_SIGNAL_LABELS.reduce((a, l) => a + (counts[l] || 0), 0)
  return Math.round((100 * n) / total)
}

export const trailHref = (t: { vote_key: string; bioguide: string }) =>
  `/trail/${encodeURIComponent(t.vote_key)}--${t.bioguide}`

/* The four things this site never claims. Defined once and rendered on every
   trail, because a disclaimer that appears only on an About page is decoration.
   Wording is deliberately absolute: no hedging verbs, no "may not". */
/* The election cycle this site publishes.
 *
 * Every aggregate must be filtered to it. An outside review found totals that
 * summed the 2024 and 2026 cycles together and labelled the result "2026 cycle"
 * — $14,360,458 where the real figure is $5,462,903. The 2024 data is still in
 * the database and still correct; it is simply not what this site publishes yet.
 * Nothing may read a money view without passing this. */
export const CYCLE = 2026
export const CYCLE_LABEL = '2026 cycle'
export const CYCLE_WINDOW = 'contributions reported 2025-01-01 to 2026-06-30'

export const DOES_NOT_PROVE = [
  'Financial alignment does not prove motive.',
  'Timing does not prove an agreement.',
  'A contribution does not prove a vote was purchased.',
  'CivicTrace identifies documented relationships and patterns \u2014 not corruption.',
] as const

/* Contact address for corrections. Set NEXT_PUBLIC_CONTACT_EMAIL before launch;
   the UI shows an unmissable warning while it is unset rather than printing a
   fake address that silently swallows reports. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || ''

/* Every name on this site should be a doorway, not a dead end. These build the
   internal route for each entity type; off-site links to the original filing
   still appear on the destination page, where they belong. */
export const sectorSlug = (s?: string | null) =>
  (s || 'Unclassified').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const hrefFor = {
  member: (slug: string) => `/member/${slug}`,
  committee: (cmteId: string) => `/committee/${cmteId}`,
  bill: (billKey: string) => `/bill/${billKey}`,
  sector: (name?: string | null) => `/sector/${sectorSlug(name)}`,
}

export const ENTITY_LABEL: Record<string, string> = {
  member: 'Politician', committee: 'Contributing committee',
  bill: 'Bill', sector: 'Sector',
}

/* ------------------------------------------------------------------ counting

   Never `.length` or `.reduce()` a Supabase response you did not bound.

   PostgREST silently caps an unbounded select at 1000 rows. Every figure this
   site has gotten wrong at scale has been the same mistake: fetch a collection,
   count it in JavaScript, print the result as a total. It is invisible until
   the table crosses 1000 rows, and then it is wrong on a page that promises
   not to be. It has now happened twice — the trail total, and the all-cycle
   sum in the deploy gate — so the counting lives here, once, and both pages
   call it rather than each writing the query again and drifting apart.

   `count: 'exact', head: true` asks Postgres for the number and transfers no
   rows at all. It is both correct and cheaper than what it replaces. */

/* Three ways to read a table, and no fourth.
 *
 * This defect has now been found seven times across four outside reviews, in
 * seven different files, by four different people, and every instance was
 * written by someone who knew about the previous six. Documentation has failed.
 * So the rule is enforced by a script instead: `npm run check:bounds` walks the
 * TypeScript AST and fails on any `db.from(...)` chain that does not carry an
 * explicit bound — a count, a `.limit()`, or a `.range()`. It runs in CI before
 * the build, so an unbounded read cannot reach a deploy.
 *
 * Use `countRows` when you want a number, `fetchAll` when you want every row
 * and the table may exceed a page, and an explicit `.limit(n)` when you want
 * the top n and n is the point. */

/** Exact row count. Transfers no rows at all — this is cheaper than the
 *  `.select()` it replaces, as well as being correct past 1000 rows. */
export async function countRows(
  table: string,
  filter: (q: any) => any = (q) => q,
): Promise<number> {
  const { count, error } = await filter(
    db.from(table).select('*', { count: 'exact', head: true }))
  if (error) throw new Error(`countRows(${table}): ${error.message}`)
  return count || 0
}

/** Every matching row, paged past PostgREST's 1000-row ceiling.
 *
 *  Throws rather than truncating if the table is larger than `max`. A silent
 *  cap is the thing this function exists to prevent, so it does not get to
 *  reintroduce one at a higher number. */
export async function fetchAll<T = any>(
  table: string,
  filter: (q: any) => any = (q) => q,
  opts: { columns?: string; pageSize?: number; max?: number } = {},
): Promise<T[]> {
  const { columns = '*', pageSize = 1000, max = 50_000 } = opts
  const out: T[] = []
  for (let from = 0; from < max; from += pageSize) {
    const { data, error } = await filter(
      db.from(table).select(columns)).range(from, from + pageSize - 1)
    if (error) throw new Error(`fetchAll(${table}): ${error.message}`)
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < pageSize) return out
  }
  throw new Error(`fetchAll(${table}): more than ${max} rows — raise max deliberately`)
}

export type LabelCounts = {
  counts: Record<string, number>
  total: number
  /** False when the labels stop partitioning the table — a classification bug,
      and the page should say so rather than print a breakdown that does not
      add up to the total beside it. */
  partitions: boolean
  /** Rows whose stored label claims one-sidedness their own figures do not
      support — i.e. published before the current rule. Zero after a refresh. */
  stale: number
}

export async function labelCounts(): Promise<LabelCounts> {
  /* Counted on `display_label`, not on the stored `label`.
   *
   * The stored label is written by the pipeline; the rule that produces it
   * changes in a code deploy. Between the deploy and the next nightly refresh
   * the two disagree, and the site was showing three trails badged "one-sided
   * industry money" on the same page as a corrections entry saying none
   * currently qualifies. `display_label` re-checks that one claim against the
   * row's own stored figures — see civictrace.one_sided_supported — so the
   * badge, the filter, the counts and the front-page cards cannot drift apart
   * from each other or from what the current rule actually supports. */
  const [pairs, { count: total }, { count: stale }] = await Promise.all([
    Promise.all(LABELS.map(async (l: string) => {
      const { count } = await db.from('trail_full')
        .select('display_label', { count: 'exact', head: true })
        .eq('cycle', CYCLE).eq('display_label', l)
      return [l, count || 0] as const
    })),
    // Filtered to the published cycle, like every row list these counts sit
    // beside. Identical today because only 2026 is published — and it would
    // absorb 2024 silently the day an earlier cycle is backfilled, which is
    // exactly the cross-cycle bug this project was rebuilt to remove.
    db.from('trail_full').select('display_label', { count: 'exact', head: true })
      .eq('cycle', CYCLE),
    db.from('trail_full').select('display_label', { count: 'exact', head: true })
      .eq('cycle', CYCLE).eq('label_stale', true),
  ])
  const counts = Object.fromEntries(pairs)
  const summed = pairs.reduce((a, [, n]) => a + n, 0)
  return { counts, total: total || 0, partitions: summed === (total || 0), stale: stale || 0 }
}

/* ------------------------------------------------------------------- links

   M22. Every off-site link on this site is built from a URL that came out of
   the database, and the database is built from files fetched off the internet.
   A `javascript:` or `data:` href in a committee record would be a stored XSS
   with a click on it. Nothing in the pipeline currently produces one, which is
   exactly the assumption worth not making. */
export function safeUrl(u?: string | null): string | null {
  if (!u) return null
  try {
    const p = new URL(String(u).trim())
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null
  } catch {
    return null   // not absolute, not parseable — not a link we will emit
  }
}

/* M18. Canonical origin for sitemap, robots and per-page metadata. Vercel sets
   VERCEL_PROJECT_PRODUCTION_URL on production builds; the fallback is the
   current deployment so a preview does not advertise production URLs. */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
  'https://civictrace.vercel.app'
).replace(/\/$/, '')
