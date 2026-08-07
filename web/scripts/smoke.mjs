#!/usr/bin/env node
/**
 * Load one live page of every route type and fail on any that errors.
 *
 * Why this exists
 * ---------------
 * Every committee page on the site returned a 500 for a day because a query
 * ordered by a column that does not exist on that view. The typecheck passed,
 * the bounds check passed, the build passed, and the smoke test I ran by hand
 * covered fourteen URLs — none of which was a committee page. A route with no
 * test is a route that is broken until a human happens to click it.
 *
 * So the list of route types lives here, and the IDs come from the database
 * rather than being pasted in, which means this keeps working when the data
 * changes and fails loudly when a route type is added without being listed.
 *
 *   node scripts/smoke.mjs [baseUrl]      default http://localhost:3000
 *
 * Exits non-zero on any non-2xx response, any uncaught page exception, or any
 * route type that could not be given an ID.
 */
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '')
const DB = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://vzvtlwfvncwwtzntndmy.supabase.co'
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || 'sb_publishable_962AMHB-5EccIqag-UyHEQ_hl5Rd4_V'

async function pick(path) {
  const r = await fetch(`${DB}/rest/v1/${path}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'civictrace' } })
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`)
  return r.json()
}

const paths = [
  '/', '/trails', '/donors', '/bills', '/industries', '/delegation', '/votes',
  '/methodology', '/corrections', '/contact', '/search', '/robots.txt', '/sitemap.xml',
  // query-string variants — these render dynamically and take different branches
  '/trails?label=' + encodeURIComponent('Party-line vote — low signal'),
  '/trails?p=2',
  '/donors?p=2',
  '/votes?kind=amendment',
  '/search?q=act',
  '/search?q=northwestern',
  '/search?q=%25',                    // a bare ilike wildcard
  '/search?q=zzzzzznothing',           // no results
  '/bill/does-not-exist',              // expected 404, checked separately
]

// One real ID for every dynamic route type. Each entry names the route so a
// missing ID is reported as "no committee to test", not as a silent skip.
const dynamic = [
  ['member',    'member?select=slug&limit=3',
    (r) => `/member/${r.slug}`],
  ['committee', 'committee_profile?select=cmte_id&cycle=eq.2026&payments_to_wi=gt.0&order=total_to_wi.desc&limit=3',
    (r) => `/committee/${r.cmte_id}`],
  ['sector',    'sector_profile?select=sector_slug&cycle=eq.2026&total_to_wi=gt.0&limit=3',
    (r) => `/sector/${r.sector_slug}`],
  ['bill',      'bill_profile?select=bill_key&has_rollcall=is.true&limit=2',
    (r) => `/bill/${r.bill_key}`],
  ['bill (no roll call)', 'bill_profile?select=bill_key&has_rollcall=is.false&limit=1',
    (r) => `/bill/${r.bill_key}`],
  ['trail',     'money_trail?select=vote_key,bioguide&cycle=eq.2026&order=rank&limit=3',
    (r) => `/trail/${encodeURIComponent(r.vote_key)}--${r.bioguide}`],
  ['vote',      'rollcall?select=vote_key&limit=3',
    (r) => `/vote/${encodeURIComponent(r.vote_key)}`],
]

const expected404 = new Set(['/bill/does-not-exist'])
const fails = []

async function check(label, path) {
  let res
  try {
    res = await fetch(BASE + path, { redirect: 'follow' })
  } catch (e) {
    fails.push(`${label} ${path} — fetch failed: ${e.message}`)
    return
  }
  const want404 = expected404.has(path)
  const ok = want404 ? res.status === 404 : res.status >= 200 && res.status < 300
  if (!ok) {
    fails.push(`${label} ${path} — ${res.status}${want404 ? ' (expected 404)' : ''}`)
    return
  }
  if (want404) { console.log(`  ok   404  ${path}`); return }
  const body = await res.text()
  // Next renders its error boundary with a 200 in some configurations; the
  // digest line is the tell.
  if (/Application error: a server-side exception/.test(body)) {
    fails.push(`${label} ${path} — server-side exception in a 200 response`)
    return
  }
  console.log(`  ok   ${res.status}  ${path}`)
}

console.log(`smoke: ${BASE}`)
for (const p of paths) await check('static', p)

for (const [label, query, toPath] of dynamic) {
  let rows = []
  try { rows = await pick(query) } catch (e) {
    fails.push(`${label} — could not fetch an ID to test: ${e.message}`); continue
  }
  if (!rows.length) { fails.push(`${label} — no rows to test with`); continue }
  for (const r of rows) await check(label, toPath(r))
}

if (fails.length) {
  console.error(`\n${fails.length} route${fails.length === 1 ? '' : 's'} failed:`)
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log(`\nsmoke: every route type loads.`)
