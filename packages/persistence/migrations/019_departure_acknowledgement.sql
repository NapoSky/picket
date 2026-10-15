-- Existing requests already went through the previous confirmation path.
ALTER TABLE guild_departure_requests ADD COLUMN acknowledged boolean NOT NULL DEFAULT true;
-- New requests may only dispatch after the private confirmation has been sent.
ALTER TABLE guild_departure_requests ALTER COLUMN acknowledged SET DEFAULT false;
CREATE OR REPLACE FUNCTION picket_pending_departures() RETURNS TABLE(guild_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT guild_id FROM public.guild_departure_requests
  WHERE acknowledged AND status IN ('pending','executing','uncertain') ORDER BY requested_at LIMIT 50
$$;
