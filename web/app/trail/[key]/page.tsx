import { notFound } from 'next/navigation'
import { db, partyLetter, officeLine, CYCLE, SITE_URL } from '@/lib/db'
import { TrailView, type Trail } from '@/components/TrailView'
import { Sleuth } from '@/components/Art'

export const revalidate = 3600

export async function generateStaticParams() {
  const { data } = await db.from('money_trail').select('vote_key,bioguide').eq('cycle', CYCLE)
    .order('rank').limit(60)
  return (data || []).map((t: any) => ({ key: `${t.vote_key}--${t.bioguide}` }))
}

function splitKey(key: string) {
  const k = decodeURIComponent(key)
  const idx = k.lastIndexOf('--')
  return idx < 0 ? null : { voteKey: k.slice(0, idx), bioguide: k.slice(idx + 2) }
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const parts = splitKey((await params).key)
  if (!parts) return { title: 'Money trail — CivicTrace' }
  const { data: rows } = await db.from('trail_full')
    .select('full_name,label,bill_title,vote_desc,legis_num,position,iso_date')
    .eq('vote_key', parts.voteKey).eq('bioguide', parts.bioguide).eq('cycle', CYCLE).limit(1)
  const t = (rows || [])[0]
  if (!t) return { title: 'Money trail — CivicTrace' }
  const subject = t.bill_title || t.vote_desc || t.legis_num
  const title = `${t.full_name} on ${t.legis_num} — CivicTrace`
  const description =
    `${t.full_name} voted ${t.position} on ${t.legis_num}${t.iso_date ? ` (${t.iso_date})` : ''}: `
    + `${subject}. Classified "${t.label}". Overlap between filed contributions and a recorded `
    + `vote — not an allegation of anything.`
  const url = `${SITE_URL}/trail/${encodeURIComponent(parts.voteKey)}--${parts.bioguide}`
  return { title, description, alternates: { canonical: url },
           openGraph: { title, description, url } }
}

export default async function TrailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const idx = decodeURIComponent(key).lastIndexOf('--')
  if (idx < 0) notFound()
  const voteKey = decodeURIComponent(key).slice(0, idx)
  const bioguide = decodeURIComponent(key).slice(idx + 2)

  // Scoped to the published cycle and taking the first row rather than
  // `.single()`. A (vote_key, bioguide) pair is unique *within* a cycle, not
  // across them — `.single()` throws when a query returns two rows, so the day
  // earlier cycles get back-filled this would have 500'd every trail page on
  // the site at once. The cycle filter makes it unique; the limit makes it
  // survive being wrong about that.
  const { data: rows } = await db.from('trail_full').select('*')
    .eq('vote_key', voteKey).eq('bioguide', bioguide).eq('cycle', CYCLE).limit(1)
  const data = (rows || [])[0]
  if (!data) notFound()
  const t = data as unknown as Trail

  return (
    <>
      <section className="hero">
        <div className="wrap hero-in">
          <div style={{ flex: 1 }}>
            <div className="eyebrow">Money trail</div>
            <h1 style={{ fontSize: 'clamp(24px,3.6vw,40px)', textTransform: 'none', marginTop: 6 }}>
              {t.bill_title || t.vote_desc}
            </h1>
            <p className="sub" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`chip ${partyLetter(t.party)}`}>{partyLetter(t.party)}</span>
              <strong>{t.full_name}</strong> ({officeLine(t)}) voted{' '}
              <strong>{t.position}</strong> on {t.legis_num} · {t.iso_date}
            </p>
          </div>
          <div className="hero-art"><Sleuth size={88} /></div>
          <div className="speech">We follow the public records.<br />You draw the conclusion.</div>
        </div>
      </section>
      <div className="wrap" style={{ paddingTop: 18 }}>
        <TrailView t={t} />
      </div>
    </>
  )
}
