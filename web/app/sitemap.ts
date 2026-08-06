import type { MetadataRoute } from 'next'
import { db, hrefFor, SITE_URL, CYCLE } from '@/lib/db'

export const revalidate = 3600

/* Every entity page, not a hand-kept list. A sitemap that lists the eight
   navigation pages and none of the 1,000+ records is a sitemap of the menu. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ data: members }, { data: bills }, { data: cmtes }, { data: sectors }] =
    await Promise.all([
      db.from('member').select('slug'),
      db.from('bill').select('bill_key'),
      db.from('committee_profile').select('cmte_id').eq('cycle', CYCLE).gt('payments_to_wi', 0),
      db.from('sector_profile').select('sector').eq('cycle', CYCLE).gt('total_to_wi', 0),
    ])

  const at = new Date()
  const url = (path: string, priority: number) => ({
    url: `${SITE_URL}${path}`, lastModified: at, priority,
  })

  return [
    url('/', 1), url('/trails', 0.9), url('/delegation', 0.9), url('/donors', 0.8),
    url('/bills', 0.8), url('/industries', 0.8), url('/earmarks', 0.7),
    url('/methodology', 0.7), url('/corrections', 0.5), url('/contact', 0.5),
    ...(members || []).map((m: any) => url(hrefFor.member(m.slug), 0.8)),
    ...(bills || []).map((b: any) => url(hrefFor.bill(b.bill_key), 0.6)),
    ...(cmtes || []).map((c: any) => url(hrefFor.committee(c.cmte_id), 0.5)),
    ...(sectors || []).map((s: any) => url(hrefFor.sector(s.sector), 0.6)),
  ]
}
