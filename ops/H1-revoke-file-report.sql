-- CivicTrace — H1: stop `anon` from calling file_report() directly
--
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- It needs owner rights, which the dashboard editor has and I do not — this is
-- the one item on the audit list I can't do for you, because doing it would
-- mean handling your service_role key in a chat log.
--
-- WHAT THE PROBLEM IS
-- The corrections form posts through civictrace.file_report(), a SECURITY
-- DEFINER function. EXECUTE is currently granted to `anon`, which is the role
-- behind the publishable key that ships in the browser bundle. So anyone can
-- POST to the RPC endpoint directly, skip the honeypot and the form entirely,
-- and write to the report queue at request rate. /corrections renders a public
-- counter off that table, so a flood is visible on the site.
--
-- WHAT THIS DOES
-- Revokes anon's EXECUTE and re-grants it to `service_role` only. The form is a
-- Next.js server action, so it can call the function with a service key that
-- never reaches a browser.
--
-- AFTER RUNNING IT, THE FORM WILL 403 UNTIL YOU DO STEP 2. Do both in one
-- sitting, or do step 2 first.

-- ---------------------------------------------------------------- step 1: SQL

begin;

revoke execute on function civictrace.file_report(
  text, text, text, text, text, text, text, boolean
) from anon, authenticated, public;

grant execute on function civictrace.file_report(
  text, text, text, text, text, text, text, boolean
) to service_role;

commit;

-- Confirm. Expect one row, and `anon` must not appear in it.
select p.proname,
       array_agg(distinct a.grantee) as can_execute
from   pg_proc p
join   pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
join   lateral (select pg_get_userbyid(acl.grantee) as grantee) a on true
where  n.nspname = 'civictrace' and p.proname = 'file_report'
  and  acl.privilege_type = 'EXECUTE'
group by p.proname;


-- ------------------------------------------------- step 2: Vercel environment
--
-- 1. Supabase Dashboard -> Project Settings -> API -> `service_role` key. Copy
--    it. Treat it like a password: it bypasses RLS entirely.
-- 2. Vercel -> the civictrace project -> Settings -> Environment Variables.
--    Add:
--        Name:  SUPABASE_SERVICE_ROLE_KEY
--        Value: <the key>
--        Environments: Production, Preview, Development
--    Leave "Sensitive" checked if Vercel offers it.
--    The name must NOT start with NEXT_PUBLIC_ — that prefix is what ships a
--    variable to the browser, which is the whole thing we are undoing here.
-- 3. Redeploy (Vercel -> Deployments -> ... -> Redeploy). Environment variables
--    are read at build time; an existing deployment will not pick it up.
--
-- The code side is already written and waiting for the variable: app/contact/
-- actions.ts uses the service client when SUPABASE_SERVICE_ROLE_KEY is present
-- and falls back to the publishable key when it is not, so the form keeps
-- working either way and starts using the privileged path the moment you set
-- it. Test after redeploying by filing a report from /contact — you should get
-- a reference code back, and the row should appear in civictrace.report.
--
-- ------------------------------------------------------------------- rollback
--
-- If something goes wrong and you need the form working immediately:
--
--   grant execute on function civictrace.file_report(
--     text, text, text, text, text, text, text, boolean
--   ) to anon;
--
-- That puts you back exactly where you are now — the form works, and the queue
-- is writable by anyone. Fine as a temporary state; not fine as the end state.
