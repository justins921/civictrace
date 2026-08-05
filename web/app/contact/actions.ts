'use server'

import { db } from '@/lib/db'

type Result = { ok: true; ref: string } | { ok: false; message: string }

export async function fileReport(fd: FormData): Promise<Result> {
  // Honeypot. A submission that fills this in is a bot; it gets the same
  // response a real reporter gets, so there is nothing to tune against.
  if (String(fd.get('company') || '').trim() !== '') {
    return { ok: true, ref: 'CT-000000' }
  }

  const s = (k: string) => {
    const v = String(fd.get(k) ?? '').trim()
    return v === '' ? null : v
  }

  const problem = s('problem')
  if (!problem) {
    return { ok: false, message: 'Please describe what is wrong — that field is the report.' }
  }

  const { data, error } = await db.rpc('file_report', {
    p_category: s('category'),
    p_page_url: s('page_url'),
    p_figure: s('figure'),
    p_problem: problem,
    p_correct_value: s('correct_value'),
    p_source_url: s('source_url'),
    p_reply_to: s('reply_to'),
  })

  if (error || !data) {
    // Surface the database's own message when it is one written for a human
    // (bad email, too long, throttled) and a neutral one otherwise. A reporter
    // who hits a wall and gets no explanation simply does not report again.
    const m = error?.message || ''
    const human = /required|too long|does not look valid|Too many reports/i.test(m)
    return {
      ok: false,
      message: human
        ? m.replace(/^.*?:\s*/, '')
        : 'Something went wrong on our end and the report was not saved. Please try again in a moment.',
    }
  }

  return { ok: true, ref: String(data) }
}
