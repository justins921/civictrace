# CivicTrace daily refresh

`daily_update.py` rebuilds the whole dataset from primary sources and republishes
it, then records the outcome in `civictrace.data_run`. The site footer reads that
table: it prints when the data was last good, and turns red if no run has
succeeded in 36 hours. A refresh that fails leaves the previous data in place.

## How it is scheduled

`serve.py` wraps the job in a tiny HTTP service so an external scheduler can start
it. Railway's own cron mode never executed the container — it deployed, logged
"Starting Container", and no job ever ran — so scheduling lives outside:

    cron-job.org  ──POST──▶  https://<railway-domain>/refresh?token=<CT_INGEST_TOKEN>

The endpoint returns **202 immediately** and runs the refresh on a background
thread, because a cron service has a short request timeout and the job takes five
to twelve minutes. Ask `/status` for the outcome, or read the site footer, which
prints the last successful refresh and turns red after 36 hours without one.

Only one refresh runs at a time; a second caller mid-run gets 409.

## Running it

    SUPABASE_URL=https://<project>.supabase.co \
    SUPABASE_ANON_KEY=<publishable key> \
    CT_INGEST_TOKEN=<write token> \
    python daily_update.py

Takes roughly 5–12 minutes from cold, most of it downloading FEC bulk files and
roll-call XML. Repeat runs skip anything the server reports unchanged.

## The write token

The loader does not hold a service_role key. It holds a token that only works
with three functions — `run_start`, `run_finish` and `ingest` — and `ingest` can
only touch eleven allow-listed fact tables. It cannot read `auth`, cannot touch
`correction`, and cannot alter the schema. Rotate it any time with:

    select civictrace.set_ingest_token('<new token>');

then update `CT_INGEST_TOKEN` wherever the job runs. `set_ingest_token` is not
callable through the API — only from the SQL editor or a service-role session.

## Publishing strategy

Reference tables (`member`, `committee`, `bill`, `rollcall`) are upserted, because
foreign keys point at them and they only grow. Everything derived from them
(`money_trail`, `bill_sector`, `rollcall_breakdown`, `vote_position`,
`pac_support`, `earmark*`) is replaced, because a stale derived row is worse than
a missing one — a trail must never outlive the inputs it was computed from.

Timing provenance is merged into the trail rows before they are published rather
than patched afterwards, so a trail is never live without the filing detail that
qualifies its timing figure.

## Moving it to GitHub Actions (free)

Once the code is in a repo, this is a drop-in replacement for the hosted cron —
add the three values as repository secrets and delete the Railway service.

```yaml
# .github/workflows/daily.yml
name: daily refresh
on:
  schedule: [{ cron: '0 9 * * *' }]   # 09:00 UTC = 4am Central
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt
      - run: python daily_update.py
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          CT_INGEST_TOKEN: ${{ secrets.CT_INGEST_TOKEN }}
          CT_SOURCE: github actions
```
