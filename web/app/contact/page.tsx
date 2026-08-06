import Link from 'next/link'
import { CONTACT_EMAIL, DOES_NOT_PROVE } from '@/lib/db'
import { ReportForm } from './ReportForm'

export const metadata = {
  title: 'Report a problem — CivicTrace',
  description: 'Found an error in the data or the wording? Tell us — every correction is published.',

}

export const dynamic = 'force-dynamic'

const KINDS: [string, string, string][] = [
  ['Incorrect contribution data',
   'A dollar figure, date, committee name or recipient that does not match the filing.',
   'The page URL, the figure as we show it, and the figure as the FEC filing shows it. If you have the FEC image number or a link to the filing, include it — that settles it immediately.'],
  ['Incorrect sector classification',
   'A committee placed in the wrong sector, or its interest side recorded backwards.',
   'The committee name, the rule ID we display beneath it, and what you believe the correct sector or side is. Our rules are published, so you can point at the specific rule that misfired.'],
  ['Missing votes or records',
   'A roll call, bill, contribution or earmark request that should be here and is not.',
   'What is missing and where you found it. Note that we currently cover the Wisconsin federal delegation only — state records are not loaded yet, and that is a known gap rather than an omission.'],
  ['Broken source links',
   'A View Source button that 404s, times out, or opens the wrong document.',
   'The page URL and which of the six source cards is broken. Government URL schemes change without notice, so these break on their own over time.'],
  ['Methodology concerns',
   'A counting rule, threshold or label you think produces a misleading result.',
   'Which rule, and what you think it gets wrong. Disagreements about where a threshold should sit are legitimate and we would rather argue about them in public than defend them quietly.'],
  ['Wording that overstates the evidence',
   'Any sentence that asserts or implies more than the underlying records support.',
   'Quote the sentence and say what it implies to you. This is the category we most want to hear about, and the one most likely to be right.'],
]

export default function Contact() {
  return (
    <div className="wrap">
      <h1 className="section">Report a problem</h1>
      <p className="lede">
        We would rather hear it than not. Reports about our own accuracy are the most useful thing
        anyone can send us, and every valid one gets published in the{' '}
        <Link href="/corrections">corrections log</Link> with what changed and when.
      </p>

      <ReportForm />

      {CONTACT_EMAIL && (
        <p className="small" style={{ marginTop: 12 }}>
          You can also email <a href={`mailto:${CONTACT_EMAIL}?subject=${
            encodeURIComponent('CivicTrace correction')}`}>{CONTACT_EMAIL}</a> if you would rather
          not use a form. The form is better only because it asks for the page and the figure, which
          is usually what an emailed report is missing.
        </p>
      )}

      <h2 className="section">What to report, and what to include</h2>
      <div className="grid g2">
        {KINDS.map(([title, what, include]) => (
          <div className="card" key={title}>
            <h3>{title}</h3>
            <p className="small" style={{ margin: '0 0 10px' }}>{what}</p>
            <div className="eyebrow">Please include</div>
            <p className="small" style={{ margin: '4px 0 0' }}>{include}</p>
          </div>
        ))}
      </div>

      <h2 className="section">What happens next</h2>
      <div className="card">
        <ol className="small" style={{ paddingLeft: 20, margin: 0 }}>
          <li style={{ marginBottom: 6 }}>We acknowledge the report.</li>
          <li style={{ marginBottom: 6 }}>
            We check it against the primary source — the FEC filing, the roll call XML, the bill
            record — not against our own database.
          </li>
          <li style={{ marginBottom: 6 }}>
            If it is a data error we fix it and publish the correction, normally within seven days.
          </li>
          <li style={{ marginBottom: 6 }}>
            If we conclude the figure is right, we say so and explain why, and we publish that too
            when the confusion is likely to be shared by other readers.
          </li>
          <li>
            If you are the subject of a page and believe it is wrong or misleading, say so plainly
            and we will treat it with the same process. You do not need a lawyer to get a factual
            error fixed here.
          </li>
        </ol>
      </div>

      <h2 className="section">Before you write</h2>
      <div className="card">
        <p className="small" style={{ marginTop: 0 }}>
          Two things account for most reports that turn out not to be errors, and both are explained
          on the <Link href="/methodology">methodology page</Link>:
        </p>
        <ul className="small" style={{ paddingLeft: 20 }}>
          <li>
            <strong>Our totals do not match the FEC candidate page, by design.</strong> We report
            what the giving committees filed (Schedule B); the candidate page reports what the
            campaign filed (Schedule A). The two never tie exactly.
          </li>
          <li>
            <strong>Most trails are labelled low or no signal on purpose.</strong> If a page tells
            you a money-and-vote overlap means nothing, that is the finding, not a failure to find
            one.
          </li>
        </ul>
        <div className="rule" />
        <div className="eyebrow" style={{ color: 'var(--blue)' }}>And to be explicit about what this site is not</div>
        <ul className="small" style={{ paddingLeft: 20, marginBottom: 0 }}>
          {DOES_NOT_PROVE.map(x => <li key={x} style={{ marginBottom: 3 }}>{x}</li>)}
        </ul>
      </div>
    </div>
  )
}
