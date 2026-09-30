-- Run in the hosted database, independent of GitHub queue delays or a laptop.
-- UTC candidates cover CST/CDT; the local-time predicate selects exactly 8 AM.
-- Bounded retries at 8:20 and 8:40 also recover transient ESPN/publication failures.
select cron.schedule('du-shamers-tuesday-results','0,20,40 13,14 * * 2',$job$
 select net.http_post(
   url:='https://xvnkwtiydyrksucgiphi.supabase.co/functions/v1/sync-weekly-winner',
   headers:='{"Content-Type":"application/json"}'::jsonb,
   body:='{"scheduled":true}'::jsonb,timeout_milliseconds:=60000)
 where extract(hour from now() at time zone 'America/Chicago')=8
   and (now() at time zone 'America/Chicago')::date between date '2026-09-08' and date '2026-12-15';
$job$);
