-- Live operational status stays independent of the scheduled activity snapshot.
-- The migration owner may read guild settings across tenants; callers receive
-- only two flags, for their selected guild or a trusted global Stats scope.
CREATE FUNCTION picket_stats_collection_status(p_guild_id text, p_stale_before timestamptz)
RETURNS TABLE (recovering boolean, delayed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(current_setting('app.stats_scope',true),'') <> 'global'
    AND (p_guild_id IS NULL OR p_guild_id IS DISTINCT FROM NULLIF(current_setting('app.guild_id',true),'')) THEN
    RAISE EXCEPTION 'Stats collection scope denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT COALESCE(bool_or(s.interrupted_at IS NOT NULL),false),
      COALESCE(bool_or(COALESCE(s.observed_through,s.enabled_at,s.changed_at)<p_stale_before),false)
    FROM public.stats_settings s
    JOIN public.guild_settings g USING(guild_id)
    JOIN public.guild_registry r USING(guild_id)
    WHERE COALESCE((g.features->>'stats')::boolean,false) AND r.inactive_since IS NULL
      AND (p_guild_id IS NULL OR s.guild_id=p_guild_id);
END;
$$;
REVOKE ALL ON FUNCTION picket_stats_collection_status(text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION picket_stats_collection_status(text,timestamptz) TO {{app_role}};
