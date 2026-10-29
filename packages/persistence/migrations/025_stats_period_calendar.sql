-- Calendar end dates resolve to an exclusive midnight. Do not show the next day as an empty bucket.
-- Preserve the existing function signature and grants; applied migrations remain unchanged.
CREATE OR REPLACE FUNCTION picket_stats_admin_report(p_from timestamptz,p_to timestamptz,p_channel text,p_limit integer,p_offset integer,p_now timestamptz)
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
      date_trunc('day',(v_to-interval '1 microsecond') AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',interval '24 hours') AS day
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
