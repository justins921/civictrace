import type { MetadataRoute } from 'next'
import { db, fetchAll, hrefFor, trailHref, SITE_URL, CYCLE } from '@/lib/db'

export const revalidate = 3600

/* Every entity page, not a hand-kept list, and not a page of one.
 *
 * H1. The previous version read each table with an unbounded `select()`, which
 * PostgREST caps at 1000 rows. It therefore advertised 1,000 of 2,419 bills —
 * 1,419 pages that exist, render, and were invisible to every crawler — and
 * listed no trail pages at all, which is the site's primary content. A sitemap
 * that silently drops 60% of the record is worse than no sitemap, because it
 * tells a crawler the rest does not exist.
 *
 * These reads go through `fetchAll`, which pages to exhaustion and throws
 * rather than truncating. `npm run check:bounds` fails the build if anyone
 * writes an unbounded read here again. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [members, bills, cmtes, sectors, rolls, trails] = await Promise.all([
    fetchAll<any>('member', (q) => q.order('slug'), { columns: 'slug' }),
    fetchAll<any>('bill', (q) => q.order('bill_key'), { columns: 'bill_key' }),
    fetchAll<any>('committee_profile',
      (q) => q.eq('cycle', CYCLE).gt('payments_to_wi', 0).order('cmte_id'), { columns: 'cmte_id' }),
    fetchAll<any>('sector_profile',
      (q) => q.eq('cycle', CYCLE).gt('total_to_wi', 0).order('sector'), { columns: 'sector' }),
    fetchAll<any>('rollcall', (q) => q.order('vote_key'), { columns: 'vote_key' }),
    fetchAll<any>('money_trail',
      (q) => q.eq('cycle', CYCLE).order('rank'), { columns: 'vote_key,bioguide' }),
  ])

  const at = new Date()
  const url = (path: string, priority: number) => ({
    url: `${SITE_URL}${path}`, lastModified: at, priority,
  })

  return [
    url('/', 1), url('/trails', 0.9), url('/delegation', 0.9), url('/donors', 0.8),
    url('/bills', 0.8), url('/industries', 0.8), url('/earmarks', 0.7),
    url('/methodology', 0.7), url('/corrections', 0.5), url('/contact', 0.5),
    url('/votes', 0.7),
    ...members.map((m: any) => url(hrefFor.member(m.slug), 0.8)),
    ...trails.map((t: any) => url(trailHref(t), 0.7)),
    ...bills.map((b: any) => url(hrefFor.bill(b.bill_key), 0.6)),
    ...cmtes.map((c: any) => url(hrefFor.committee(c.cmte_id), 0.5)),
    ...sectors.map((s: any) => url(hrefFor.sector(s.sector), 0.6)),
    ...rolls.map((r: any) => url(`/vote/${encodeURIComponent(r.vote_key)}`, 0.4)),
  ]
}
