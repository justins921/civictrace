'use client'

/* The corrections form.
 *
 * It asks for the URL and the figure in dispute because a report without them
 * usually cannot be acted on, and chasing the reporter for basics is how a
 * correction queue quietly dies. Nothing here is required except a description —
 * a vague report is still worth more than a bounced email.
 *
 * Submissions go through a database function, not a table write: the reports
 * table has no RLS policies at all, so it cannot be read or written through the
 * API in either direction. A report can name a person and carries a reply
 * address; it is not public data, and no key shipped to a browser should be able
 * to read it back.
 */

import { useState } from 'react'
import { fileReport } from './actions'

const CATEGORIES = [
  'Incorrect contribution data',
  'Incorrect sector classification',
  'Missing votes or records',
  'Broken source links',
  'Methodology concerns',
  'Wording that overstates the evidence',
]

export function ReportForm({ defaultUrl = '' }: { defaultUrl?: string }) {
  const [state, setState] = useState<
    { status: 'idle' | 'sending' } | { status: 'sent'; ref: string } | { status: 'error'; message: string }
  >({ status: 'idle' })

  if (state.status === 'sent') {
    return (
      <div className="card" id="report">
        <div className="eyebrow">Report received</div>
        <div className="kpi mono" style={{ marginTop: 6 }}>{state.ref}</div>
        <p className="small" style={{ marginTop: 10 }}>
          That is your reference. Keep it — if this becomes a published correction, the entry in the
          corrections log will carry the same code, so you can find the outcome of your own report
          without having to take our word for it.
        </p>
        <p className="small" style={{ marginBottom: 0 }}>
          If you left an email address we will use it only to ask a follow-up question about this
          report. Nothing else, ever.
        </p>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => setState({ status: 'idle' })}>
          Report something else
        </button>
      </div>
    )
  }

  return (
    <form
      className="card"
      id="report"
      action={async (fd: FormData) => {
        setState({ status: 'sending' })
        const r = await fileReport(fd)
        if (r.ok) setState({ status: 'sent', ref: r.ref })
        else setState({ status: 'error', message: r.message })
      }}
    >
      <div className="eyebrow">Report a problem</div>

      {state.status === 'error' && (
        <p className="small" style={{ color: '#b23c45', marginTop: 8 }} role="alert">
          {state.message}
        </p>
      )}

      <div className="formgrid">
        <label>
          <span>What kind of problem?</span>
          <select name="category" defaultValue={CATEGORIES[0]}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label>
          <span>Which page? <em>optional, but it speeds everything up</em></span>
          <input name="page_url" type="text" defaultValue={defaultUrl}
            placeholder="https://civictrace.vercel.app/committee/C00197095" />
        </label>

        <label>
          <span>Which figure or sentence? <em>optional</em></span>
          <input name="figure" type="text" placeholder="$45,500 — “Given to Wisconsin members”" />
        </label>

        <label className="wide">
          <span>What is wrong with it? <em>required</em></span>
          <textarea name="problem" rows={5} required maxLength={8000}
            placeholder="Tell us what you are seeing and why you believe it is wrong. If you disagree with a judgement rather than a number, say that — those reports are welcome and we publish them too." />
        </label>

        <label>
          <span>What should it say instead? <em>optional</em></span>
          <input name="correct_value" type="text" placeholder="$44,000, per the amended filing" />
        </label>

        <label>
          <span>Source that settles it <em>optional</em></span>
          <input name="source_url" type="text" placeholder="FEC image number, or a link to the filing" />
        </label>

        <label>
          <span>Your email <em>optional — only used to ask a follow-up about this report</em></span>
          <input name="reply_to" type="email" placeholder="you@example.com" />
        </label>
      </div>

      {/* Honeypot. The name is deliberately meaningless: autofill and password
          managers target company/organization/address regardless of
          autocomplete="off", and a tripped honeypot used to silently destroy the
          report. It now only flags for triage — nothing is ever discarded. */}
      <div aria-hidden style={{ position: 'absolute', left: '-9999px' }}>
        <label>Leave this empty
          <input name="ct_hp_7f2" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <button className="btn solid" type="submit" disabled={state.status === 'sending'}
        style={{ marginTop: 16 }}>
        {state.status === 'sending' ? 'Sending…' : 'Send report'}
      </button>

      <p className="tiny" style={{ marginTop: 10, marginBottom: 0 }}>
        Anonymous reports are fine. We do not log your IP address, and the form sets no cookies.
      </p>
    </form>
  )
}
