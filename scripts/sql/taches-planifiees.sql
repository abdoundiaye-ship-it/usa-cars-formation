-- Sauvegardes (G3-a) : tâches pg_cron (non comprises dans la copie de la base), en JSON. Lecture seule.
select coalesce(json_agg(json_build_object('jobname', jobname, 'schedule', schedule, 'command', command)
  order by jobname), '[]'::json)
from cron.job;
