update public.tracker_policy set enabled=false where singleton;
select cron.unschedule(jobid) from cron.job where jobname='du-shamers-weekly-tracker';
