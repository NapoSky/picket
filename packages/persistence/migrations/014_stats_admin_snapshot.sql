-- Private materialized read models. Only guarded functions expose them to the application.
-- The owning migration role reads source rows through the same global context as the collector.
CREATE TABLE stats_admin_snapshot_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0,
  published_revision bigint NOT NULL DEFAULT -1,
  snapshot_at timestamptz,
  scheduled_at timestamptz
);
INSERT INTO stats_admin_snapshot_state(singleton) VALUES(true);

CREATE FUNCTION stats_admin_clock() RETURNS timestamptz LANGUAGE sql STABLE
SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(NULLIF(current_setting('app.stats_snapshot_at',true),'')::timestamptz,statement_timestamp())
$$;

-- Keep exact interval boundaries for partial days, session counts and distinct people.
-- Full days use precomputed totals rather than expanding facts at every dashboard read.
CREATE MATERIALIZED VIEW stats_admin_days AS
WITH intervals AS (
  SELECT guild_id,user_id,channel_id,started_at AS original_start,quality,end_reason,ended_at IS NOT NULL AND ended_at<=stats_admin_clock() AS closed,
    GREATEST(started_at,stats_admin_clock()-interval '60 days') AS a,
    LEAST(COALESCE(ended_at,confirmed_through),stats_admin_clock()) AS b
  FROM stats_voice_segments
  WHERE started_at<stats_admin_clock() AND COALESCE(ended_at,confirmed_through)>stats_admin_clock()-interval '60 days'
), slices AS (
  SELECT guild_id,user_id,channel_id,quality,end_reason,closed,original_start,a,b,d AS day,
    GREATEST(a,d) AS slice_start,LEAST(b,d+interval '24 hours') AS slice_end
  FROM intervals CROSS JOIN LATERAL generate_series(
    date_trunc('day',a AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
    date_trunc('day',b AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',interval '24 hours') d
  WHERE a<d+interval '24 hours' AND (b>d OR a=b)
)
SELECT guild_id,user_id,channel_id,day,
  SUM(EXTRACT(EPOCH FROM slice_end-slice_start))::double precision AS seconds,
  COUNT(*) FILTER (WHERE original_start>=day) AS new_sessions,
  COUNT(*) AS overlapping_sessions,
  COUNT(*) FILTER (WHERE quality='interrupted' AND original_start>=day) AS interrupted,
  MAX(slice_end) AS last_activity,MAX(original_start) AS last_start,
  range_agg(tstzrange(slice_start,slice_end,'[)')) AS ranges,
  array_agg(original_start ORDER BY original_start,b) AS starts,array_agg(b ORDER BY original_start,b) AS ends,array_agg(quality ORDER BY original_start,b) AS qualities,
  array_agg(end_reason ORDER BY original_start,b) AS end_reasons,array_agg(closed ORDER BY original_start,b) AS closed
FROM slices GROUP BY guild_id,user_id,channel_id,day WITH NO DATA;
CREATE UNIQUE INDEX stats_admin_days_key ON stats_admin_days(guild_id,user_id,channel_id,day);
CREATE INDEX stats_admin_days_time ON stats_admin_days(day,channel_id);
CREATE INDEX stats_admin_days_recent ON stats_admin_days(last_start DESC);

CREATE MATERIALIZED VIEW stats_admin_hours AS
WITH intervals AS (
  SELECT day,channel_id,lower(r) AS a,upper(r) AS b FROM stats_admin_days CROSS JOIN LATERAL unnest(ranges) r
), bins AS (
  SELECT day,channel_id,a,b,generate_series(date_trunc('hour',a AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',b,interval '1 hour') AS slot
  FROM intervals
)
SELECT day,channel_id,EXTRACT(HOUR FROM slot AT TIME ZONE 'UTC')::integer AS hour,
  SUM(GREATEST(0,EXTRACT(EPOCH FROM LEAST(b,slot+interval '1 hour')-GREATEST(a,slot))))::double precision AS seconds
FROM bins GROUP BY day,channel_id,hour WITH NO DATA;
CREATE UNIQUE INDEX stats_admin_hours_key ON stats_admin_hours(day,channel_id,hour);

CREATE MATERIALIZED VIEW stats_admin_peaks AS
WITH intervals AS (
  SELECT day,channel_id,lower(r) AS a,upper(r) AS b FROM stats_admin_days CROSS JOIN LATERAL unnest(ranges) r
), changes AS (
  SELECT day,channel_id,a AS at,1 AS delta FROM intervals
  UNION ALL SELECT day,channel_id,b,-1 FROM intervals
), grouped AS (
  SELECT day,channel_id,at,SUM(delta) AS delta FROM changes GROUP BY GROUPING SETS ((day,channel_id,at),(day,at))
), counts AS (
  SELECT day,channel_id,SUM(delta) OVER(PARTITION BY day,channel_id ORDER BY at) AS n FROM grouped
)
SELECT day,channel_id,MAX(n)::bigint AS peak FROM counts GROUP BY day,channel_id WITH NO DATA;
CREATE UNIQUE INDEX stats_admin_peaks_key ON stats_admin_peaks(day,channel_id) NULLS NOT DISTINCT;

CREATE MATERIALIZED VIEW stats_admin_live AS
SELECT guild_id,user_id,channel_id FROM stats_voice_segments
WHERE ended_at IS NULL AND started_at<stats_admin_clock() AND confirmed_through>stats_admin_clock()-interval '120 seconds'
WITH NO DATA;
CREATE UNIQUE INDEX stats_admin_live_key ON stats_admin_live(guild_id,user_id);

-- Invalidate in the erasure transaction. No stale personal contributions can be served.
-- The next leased refresh cleans the physical copies; the web request never runs REFRESH.
CREATE FUNCTION stats_admin_invalidate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog,public AS $$
BEGIN
  IF TG_TABLE_NAME='stats_privacy' AND TG_OP='UPDATE' THEN
    IF NEW.erased_before IS NOT DISTINCT FROM OLD.erased_before THEN RETURN NULL; END IF;
  END IF;
  UPDATE public.stats_admin_snapshot_state SET revision=revision+1;
  RETURN NULL;
END $$;
CREATE TRIGGER stats_admin_erased AFTER INSERT OR UPDATE OF erased_before ON stats_privacy
FOR EACH ROW WHEN (NEW.erased_before>'epoch'::timestamptz) EXECUTE FUNCTION stats_admin_invalidate();
CREATE TRIGGER stats_admin_guild_purged AFTER DELETE ON guild_registry
FOR EACH STATEMENT EXECUTE FUNCTION stats_admin_invalidate();

CREATE FUNCTION picket_stats_admin_status()
RETURNS TABLE(snapshot_at timestamptz,scheduled_at timestamptz,dirty boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
  SELECT s.snapshot_at,s.scheduled_at,COALESCE(s.published_revision<>s.revision,true)
  FROM (VALUES(1)) AS seed(n) LEFT JOIN public.stats_admin_snapshot_state s ON true
$$;

CREATE FUNCTION picket_stats_admin_invalidate() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog,public AS $$
BEGIN
  IF COALESCE(current_setting('app.stats_scope',true),'')<>'global' THEN
    RAISE EXCEPTION 'global stats context required' USING ERRCODE='42501';
  END IF;
  UPDATE public.stats_admin_snapshot_state SET revision=revision+1;
END $$;

CREATE FUNCTION picket_stats_admin_refresh(p_at timestamptz,p_schedule timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE v_revision bigint; v_view text; v_populated boolean;
BEGIN
  IF COALESCE(current_setting('app.stats_scope',true),'')<>'global' THEN
    RAISE EXCEPTION 'global stats context required' USING ERRCODE='42501';
  END IF;
  IF NOT pg_try_advisory_xact_lock(727014) THEN RETURN false; END IF;
  INSERT INTO public.stats_admin_snapshot_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
  SELECT revision INTO v_revision FROM public.stats_admin_snapshot_state;
  PERFORM set_config('app.stats_snapshot_at',p_at::text,true);
  FOREACH v_view IN ARRAY ARRAY['stats_admin_days','stats_admin_hours','stats_admin_peaks','stats_admin_live'] LOOP
    SELECT relispopulated INTO v_populated FROM pg_class WHERE oid=format('public.%I',v_view)::regclass;
    EXECUTE format('REFRESH MATERIALIZED VIEW %s public.%I',CASE WHEN v_populated THEN 'CONCURRENTLY' ELSE '' END,v_view);
    EXECUTE format('ANALYZE public.%I',v_view);
  END LOOP;
  -- This row is only locked at publication, never during the long rebuild.
  -- REPEATABLE READ aborts publication if an erasure changed the revision meanwhile.
  UPDATE public.stats_admin_snapshot_state SET snapshot_at=p_at,scheduled_at=p_schedule,published_revision=v_revision;
  RETURN true;
END $$;

CREATE FUNCTION stats_admin_partial(p_ranges tstzmultirange,p_starts timestamptz[],p_ends timestamptz[],p_qualities text[],p_day timestamptz,p_from timestamptz,p_to timestamptz)
RETURNS TABLE(seconds double precision,sessions bigint,last_activity timestamptz,interrupted bigint)
LANGUAGE sql IMMUTABLE ROWS 1 SET search_path = pg_catalog,public AS $$
  SELECT (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM upper(r)-lower(r))),0)::double precision
          FROM unnest(p_ranges*tstzmultirange(tstzrange(p_from,p_to,'[)'))) r),
    COUNT(*) FILTER (WHERE a<p_to AND b>p_from AND (p_day<=p_from OR a>=p_day)),
    MAX(LEAST(b,p_to,p_day+interval '24 hours')) FILTER (WHERE a<p_to AND b>p_from),
    COUNT(*) FILTER (WHERE q='interrupted' AND a>=GREATEST(p_from,p_day) AND a<p_to)
  FROM unnest(p_starts,p_ends,p_qualities) AS f(a,b,q)
$$;

CREATE FUNCTION picket_stats_admin_report(p_from timestamptz,p_to timestamptz,p_channel text,p_limit integer,p_offset integer,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog,public SET jit=off AS $$
DECLARE v_at timestamptz; v_from timestamptz; v_to timestamptz; v_result jsonb;
BEGIN
  IF COALESCE(current_setting('app.stats_scope',true),'')<>'global' THEN
    RAISE EXCEPTION 'global stats context required' USING ERRCODE='42501';
  END IF;
  SELECT snapshot_at INTO v_at FROM public.stats_admin_snapshot_state WHERE published_revision=revision;
  IF v_at IS NULL OR v_at<=p_now-interval '60 days' THEN RAISE EXCEPTION 'stats_snapshot_pending' USING ERRCODE='55000'; END IF;
  v_from:=GREATEST(p_from,p_now-interval '60 days'); v_to:=LEAST(p_to,p_now,v_at);
  IF v_from>=v_to THEN
    v_from:=v_to;
  END IF;
  WITH bounded AS NOT MATERIALIZED (
    SELECT d.*,CASE WHEN day>=v_from AND day+interval '24 hours'<=v_to THEN true ELSE false END AS complete
    FROM public.stats_admin_days d WHERE day<v_to AND day+interval '24 hours'>v_from
      AND (p_channel IS NULL OR channel_id=p_channel)
  ), activity AS NOT MATERIALIZED (
    SELECT guild_id,user_id,channel_id,day,seconds,
      CASE WHEN day=v_from THEN overlapping_sessions ELSE new_sessions END AS sessions,
      last_activity,interrupted FROM bounded WHERE complete
    UNION ALL
    SELECT guild_id,user_id,channel_id,day,p.seconds,p.sessions,p.last_activity,p.interrupted
    FROM bounded d CROSS JOIN LATERAL public.stats_admin_partial(ranges,starts,ends,qualities,day,v_from,v_to) p
    WHERE NOT complete
  ), visible AS MATERIALIZED (SELECT * FROM activity WHERE seconds>0 OR sessions>0),
  daily AS (
    SELECT guild_id,day,SUM(seconds) AS seconds,COUNT(DISTINCT user_id) AS users
    FROM visible GROUP BY GROUPING SETS ((guild_id,day),(day))
  ), people AS (
    SELECT guild_id,user_id,SUM(seconds) AS seconds,SUM(sessions) AS sessions,MAX(last_activity) AS last_activity
    FROM visible GROUP BY guild_id,user_id
  ), page AS (
    SELECT * FROM people ORDER BY seconds DESC,guild_id,user_id LIMIT LEAST(10001,GREATEST(1,p_limit)+1) OFFSET GREATEST(0,p_offset)
  ), live AS (
    SELECT guild_id,COUNT(*) AS n FROM public.stats_admin_live WHERE p_channel IS NULL OR channel_id=p_channel GROUP BY guild_id
  ), servers AS (
    SELECT guild_id,SUM(seconds) AS seconds,COUNT(DISTINCT user_id) AS users,SUM(sessions) AS sessions
    FROM visible GROUP BY guild_id
  ), calendar AS (
    SELECT generate_series(date_trunc('day',v_from AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
      date_trunc('day',v_to AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',interval '24 hours') AS day
  ), partial_intervals AS MATERIALIZED (
    SELECT day,GREATEST(lower(r),v_from) AS a,LEAST(upper(r),v_to) AS b FROM bounded CROSS JOIN LATERAL unnest(ranges) r
    WHERE NOT complete AND lower(r)<v_to AND upper(r)>v_from
  ), partial_changes AS (
    SELECT day,a AS at,1 AS delta FROM partial_intervals UNION ALL SELECT day,b,-1 FROM partial_intervals
  ), partial_grouped AS (SELECT day,at,SUM(delta) AS delta FROM partial_changes GROUP BY day,at),
  partial_counts AS (SELECT SUM(delta) OVER(PARTITION BY day ORDER BY at) AS n FROM partial_grouped),
  hour_rows AS (
    SELECT hour,seconds FROM public.stats_admin_hours WHERE day>=v_from AND day+interval '24 hours'<=v_to
      AND (p_channel IS NULL OR channel_id=p_channel)
    UNION ALL
    SELECT EXTRACT(HOUR FROM slot AT TIME ZONE 'UTC')::integer,
      GREATEST(0,EXTRACT(EPOCH FROM LEAST(b,slot+interval '1 hour')-GREATEST(a,slot)))::double precision
    FROM partial_intervals CROSS JOIN LATERAL generate_series(
      date_trunc('hour',a AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',b,interval '1 hour') slot
  ), hours AS (SELECT hour,SUM(seconds) AS seconds FROM hour_rows GROUP BY hour),
  channels AS (
    SELECT channel_id,SUM(seconds) AS seconds FROM visible GROUP BY channel_id ORDER BY seconds DESC LIMIT 100
  ), recent_candidates AS (
    (SELECT d.* FROM public.stats_admin_days d
      WHERE v_to=v_at AND day<v_to AND day+interval '24 hours'>v_from AND (new_sessions>0 OR day<=v_from)
        AND (p_channel IS NULL OR channel_id=p_channel)
        AND (last_start>=v_from OR EXISTS(SELECT 1 FROM unnest(starts,ends) f(a,b) WHERE a<v_to AND b>v_from AND (a>=day OR day<=v_from)))
      ORDER BY last_start DESC LIMIT 100)
    UNION ALL
    (SELECT d.* FROM public.stats_admin_days d
      WHERE v_to<v_at AND day<v_to AND day+interval '24 hours'>v_from AND (new_sessions>0 OR day<=v_from)
        AND (p_channel IS NULL OR channel_id=p_channel)
        AND EXISTS(SELECT 1 FROM unnest(starts,ends) f(a,b) WHERE a<v_to AND b>v_from AND (a>=day OR day<=v_from))
      ORDER BY CASE WHEN last_start<v_to THEN last_start ELSE
        (SELECT MAX(a) FROM unnest(starts,ends) f(a,b) WHERE a<v_to AND b>v_from AND (a>=day OR day<=v_from)) END DESC
      LIMIT 100)
  ), recent AS (
    SELECT d.guild_id,d.user_id,COALESCE(u.name,d.user_id) AS name,COALESCE(c.name,d.channel_id) AS channel,
      GREATEST(f.a,p_now-interval '60 days') AS started_at,CASE WHEN f.closed THEN f.b ELSE NULL END AS ended_at,
      f.b AS confirmed_through,GREATEST(0,EXTRACT(EPOCH FROM LEAST(f.b,v_to)-GREATEST(f.a,v_from))) AS seconds,
      f.quality,CASE WHEN f.closed THEN f.reason ELSE NULL END AS end_reason
    FROM recent_candidates d CROSS JOIN LATERAL unnest(starts,ends,qualities,end_reasons,closed) f(a,b,quality,reason,closed)
    LEFT JOIN public.stats_users u USING(guild_id,user_id) LEFT JOIN public.stats_channels c USING(guild_id,channel_id)
    WHERE f.a<v_to AND f.b>v_from AND (f.a>=day OR day<=v_from)
    ORDER BY f.a DESC,d.guild_id,d.user_id,d.channel_id LIMIT 100
  )
  SELECT jsonb_build_object(
    'from',v_from,'to',v_to,'timezone','UTC','snapshotAt',v_at,'updatedAt',v_at,
    'seconds',(SELECT COALESCE(SUM(seconds),0) FROM visible),
    'activeUsers',(SELECT COUNT(DISTINCT user_id) FROM visible),
    'sessions',(SELECT COALESCE(SUM(sessions),0) FROM visible),
    'interruptedSegments',(SELECT COALESCE(SUM(interrupted),0) FROM visible),
    'interruptedAt',(SELECT MAX(interrupted_at) FROM public.stats_settings WHERE interrupted_at>p_now-interval '60 days'),
    'inVoice',(SELECT COALESCE(SUM(n),0) FROM live),
    'daily',(SELECT COALESCE(jsonb_agg(jsonb_build_object('day',to_char(cal.day AT TIME ZONE 'UTC','YYYY-MM-DD'),'seconds',COALESCE(d.seconds,0),'users',COALESCE(d.users,0)) ORDER BY cal.day),'[]')
      FROM calendar cal LEFT JOIN daily d ON d.guild_id IS NULL AND d.day=cal.day),
    'serverActivity',(SELECT COALESCE(jsonb_agg(jsonb_build_object('guildId',COALESCE(s.guild_id,l.guild_id),'seconds',COALESCE(s.seconds,0),'activeUsers',COALESCE(s.users,0),'sessions',COALESCE(s.sessions,0),'inVoice',COALESCE(l.n,0),
      'daily',(SELECT COALESCE(jsonb_agg(jsonb_build_object('day',to_char(d.day AT TIME ZONE 'UTC','YYYY-MM-DD'),'seconds',d.seconds,'users',d.users) ORDER BY d.day),'[]') FROM daily d WHERE d.guild_id=COALESCE(s.guild_id,l.guild_id))) ORDER BY s.seconds DESC NULLS LAST,COALESCE(s.guild_id,l.guild_id)),'[]')
      FROM servers s FULL JOIN live l USING(guild_id)),
    'users',(SELECT COALESCE(jsonb_agg(jsonb_build_object('guildId',p.guild_id,'userId',p.user_id,'name',COALESCE(u.name,p.user_id),'seconds',p.seconds,'sessions',p.sessions,'lastActivity',p.last_activity) ORDER BY p.seconds DESC,p.guild_id,p.user_id),'[]')
      FROM (SELECT * FROM page ORDER BY seconds DESC,guild_id,user_id LIMIT GREATEST(1,p_limit)) p LEFT JOIN public.stats_users u USING(guild_id,user_id)),
    'truncated',(SELECT COUNT(*)>p_limit FROM page),
    'channels',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',channel_id,'name',COALESCE((SELECT MAX(name) FROM public.stats_channels c WHERE c.channel_id=channels.channel_id),channel_id),'seconds',seconds) ORDER BY seconds DESC),'[]') FROM channels),
    'peakConcurrency',GREATEST(COALESCE((SELECT MAX(peak) FROM public.stats_admin_peaks WHERE day>=v_from AND day+interval '24 hours'<=v_to AND channel_id IS NOT DISTINCT FROM p_channel),0),COALESCE((SELECT MAX(n) FROM partial_counts),0)),
    'hourly',(SELECT COALESCE(jsonb_agg(jsonb_build_object('hour',hour,'seconds',seconds) ORDER BY hour),'[]') FROM hours),
    'recent',(SELECT COALESCE(jsonb_agg(jsonb_build_object('guildId',guild_id,'userId',user_id,'name',name,'channel',channel,'startedAt',started_at,'endedAt',ended_at,'confirmedThrough',confirmed_through,'seconds',seconds,'quality',quality,'endReason',end_reason) ORDER BY started_at DESC),'[]') FROM recent)
  ) INTO v_result;
  RETURN v_result;
END $$;

-- A descending recent-presence read should not sort all retained segments.

REVOKE ALL ON stats_admin_snapshot_state,stats_admin_days,stats_admin_hours,stats_admin_peaks,stats_admin_live FROM PUBLIC;
REVOKE ALL ON FUNCTION stats_admin_clock(),stats_admin_partial(tstzmultirange,timestamptz[],timestamptz[],text[],timestamptz,timestamptz,timestamptz),stats_admin_invalidate() FROM PUBLIC;
REVOKE ALL ON FUNCTION picket_stats_admin_status(),picket_stats_admin_invalidate(),picket_stats_admin_refresh(timestamptz,timestamptz),picket_stats_admin_report(timestamptz,timestamptz,text,integer,integer,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION picket_stats_admin_status(),picket_stats_admin_invalidate(),picket_stats_admin_refresh(timestamptz,timestamptz),picket_stats_admin_report(timestamptz,timestamptz,text,integer,integer,timestamptz) TO {{app_role}};
