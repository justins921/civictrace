import { notFound } from 'next/navigation'
import { db, partyLetter, officeLine } from '@/lib/db'
import { TrailView, type Trail } from '@/components/TrailView'
import { Sleuth } from '@/components/Art'

export const revalidate = 3600

export async function generateStaticParams() {
  const { data } = await db.from('money_trail').select('vote_key,bioguide').order('rank').limit(60)
  return (data || []).map((t: any) => ({ key: `${t.vote_key}--${t.bioguide}` }))
}

export default async function TrailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const idx = decodeURIComponent(key).lastIndexOf('--')
  if (idx < 0) notFound()
  const voteKey = decodeURIComponent(key).slice(0, idx)
  const bioguide = decodeURIComponent(key).slice(idx + 2)

  const { data } = await db.from('trail_full').select('*')
    .eq('vote_key', voteKey).eq('bioguide', bioguide).single()
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
