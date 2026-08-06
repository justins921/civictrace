'use server'

import { db } from '@/lib/db'

// One flat shape rather than a discriminated union: this project compiles with
// `strict: false`, and without strictNullChecks TypeScript will not narrow a
// union on a boolean literal. The union looked safer and silently wasn't —
// every read of `.message` was an error the build did not surface.
export type Result = { ok: boolean; ref: string; message: string }

export async function fileReport(fd: FormData): Promise<Result> {
  // Honeypot, as a signal and never as a filter.
  //
  // The previous version discarded the submission and returned a fake reference
  // — on a site that promises every correction is published. Browser autofill
  // and password managers fill anything named company/organization regardless of
  // autocomplete="off", so a real reporter could be told "keep this reference"
  // for a report that was never written. That is the worst failure this form
  // has. Now the report is always stored; a tripped honeypot only marks it for
  // triage and keeps it out of the public counter until a human looks.
  const flagged = String(fd.get('ct_hp_7f2') || '').trim() !== ''

  const s = (k: string) => {
    const v = String(fd.get(k) ?? '').trim()
    return v === '' ? null : v
  }

  const problem = s('problem')
  if (!problem) {
    return { ok: false, ref: '', message: 'Please describe what is wrong — that field is the report.' }
  }

  const { data, error } = await db.rpc('file_report', {
    p_category: s('category'),
    p_page_url: s('page_url'),
    p_figure: s('figure'),
    p_problem: problem,
    p_correct_value: s('correct_value'),
    p_source_url: s('source_url'),
    p_reply_to: s('reply_to'),
    p_flagged: flagged,
  })

  if (error || !data) {
    // Surface the database's own message when it is one written for a human
    // (bad email, too long, throttled) and a neutral one otherwise. A reporter
    // who hits a wall and gets no explanation simply does not report again.
    // M21: key off our own error codes, never off the text of a Postgres
    // message. Substring-matching raw database errors reflected internals like
    // `value too long for type character varying(200)` straight into the page.
    const HUMAN: Record<string, string> = {
      CT001: 'Please describe what is wrong — that field is the report.',
      CT002: 'That submission is longer than we accept. Please trim it and try again.',
      CT003: 'That email address does not look valid. Leave it blank if you would rather stay anonymous.',
      CT004: 'We have taken a lot of reports in the last hour. Please try again shortly.',
    }
    const code = (error as { code?: string } | null)?.code || ''
    return {
      ok: false,
      ref: '',
      message: HUMAN[code]
        || 'Something went wrong on our end and the report was not saved. Please try again in a moment.',
    }
  }

  return { ok: true, ref: String(data), message: '' }
}
