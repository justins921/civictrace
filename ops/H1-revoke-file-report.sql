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
-- This file is split into 1a (safe, additive, run any time) and 1b (the
-- irreversible half). Run 1a, do step 2, test the form, then run 1b.

-- ---------------------------------------------------------------- step 1: SQL

-- ORDER MATTERS, AND SO DOES THE SCHEMA GRANT.
--
-- The first version of this file granted EXECUTE and stopped there, and the
-- chat instructions that went with it said to set the Vercel variable first and
-- run the SQL second. Both were wrong, and together they took the form down:
--
--   * Setting SUPABASE_SERVICE_ROLE_KEY switches writeClient() to the
--     service_role role immediately. If that role cannot call the function yet,
--     the form breaks the moment the variable exists — before any revoke.
--   * EXECUTE on a function is necessary and NOT sufficient. Postgres checks
--     USAGE on the containing schema first. `anon` has always had USAGE on
--     civictrace, which is how the site reads; `service_role` never had it,
--     because nothing had ever connected as it. Granting EXECUTE alone left the
--     call failing one step earlier, with a permission error that names the
--     schema, not the function.
--
-- So: grant everything service_role needs, in one transaction, BEFORE revoking
-- anything. Then confirm the form works. Then revoke.

-- ------------------------------------------------- step 1a: let service_role in

begin;

grant usage on schema civictrace to service_role;

grant execute on function civictrace.file_report(
  text, text, text, text, text, text, text, boolean
) to service_role;

commit;

-- Prove it before removing the fallback. This executes the function AS
-- service_role and rolls the row back, so it tests the real permission path
-- without leaving anything in the queue.
begin;
do $$
declare v text;
begin
  set local role service_role;
  select civictrace.file_report('Methodology concerns', null, null,
    'permission probe', null, null, null, false) into v;
  reset role;
  raise notice 'service_role executed file_report, ref=%', v;
end $$;
rollback;

-- Both must be true before continuing.
select has_schema_privilege('service_role', 'civictrace', 'USAGE')  as schema_usage,
       has_function_privilege('service_role',
         'civictrace.file_report(text,text,text,text,text,text,text,boolean)',
         'EXECUTE') as fn_execute;

-- STOP HERE. Set SUPABASE_SERVICE_ROLE_KEY in Vercel (step 2 below), redeploy,
-- and file a real test report at /contact. Only when that returns a reference
-- code should you run step 1b — until then `anon` is the working fallback and
-- removing it is what makes this irreversible.

-- ------------------------------------------- step 1b: close the public door

begin;

revoke execute on function civictrace.file_report(
  text, text, text, text, text, text, text, boolean
) from anon, authenticated, public;

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
