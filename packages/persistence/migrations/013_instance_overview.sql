-- Aggregate deployment counts are shared with signed-in dashboard users.
-- Only the migration owner can read settings across tenants; the application
-- receives counts through this parameterless function, never per-guild settings.
CREATE POLICY instance_overview_owner_read ON guild_settings FOR SELECT TO CURRENT_USER
  USING (true);

CREATE FUNCTION picket_instance_overview()
RETURNS TABLE (active_guilds bigint, timers bigint, todolists bigint, warlog bigint, stats bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COUNT(*),
    COUNT(*) FILTER (WHERE s.features->>'timers' = 'true'),
    COUNT(*) FILTER (WHERE s.features->>'todolists' = 'true'),
    COUNT(*) FILTER (WHERE s.features->>'warlog' = 'true'),
    COUNT(*) FILTER (WHERE s.features->>'stats' = 'true')
  FROM public.guild_registry r LEFT JOIN public.guild_settings s USING (guild_id)
  WHERE r.inactive_since IS NULL
$$;
REVOKE ALL ON FUNCTION picket_instance_overview() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION picket_instance_overview() TO {{app_role}};
