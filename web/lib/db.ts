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

/* Four honest states. Ordering matters: this is also the sort key everywhere. */
export const LABELS = [
  'Notable overlap',
  'Some overlap',
  'Party-line vote — low signal',
  'Near-unanimous vote — no signal',
] as const

export function labelClass(label: string) {
  if (label.startsWith('Notable')) return { badge: 'b-note', verdict: 'v-note', angle: 62 }
  if (label.startsWith('Some')) return { badge: 'b-some', verdict: 'v-some', angle: 20 }
  if (label.startsWith('Party-line')) return { badge: 'b-low', verdict: 'v-low', angle: -30 }
  return { badge: 'b-low', verdict: 'v-none', angle: -66 }
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

export type LabelCounts = {
  counts: Record<string, number>
  total: number
  /** False when the labels stop partitioning the table — a classification bug,
      and the page should say so rather than print a breakdown that does not
      add up to the total beside it. */
  partitions: boolean
}

export async function labelCounts(): Promise<LabelCounts> {
  const [pairs, { count: total }] = await Promise.all([
    Promise.all(LABELS.map(async (l: string) => {
      const { count } = await db.from('money_trail')
        .select('label', { count: 'exact', head: true }).eq('label', l)
      return [l, count || 0] as const
    })),
    db.from('money_trail').select('label', { count: 'exact', head: true }),
  ])
  const counts = Object.fromEntries(pairs)
  const summed = pairs.reduce((a, [, n]) => a + n, 0)
  return { counts, total: total || 0, partitions: summed === (total || 0) }
}
