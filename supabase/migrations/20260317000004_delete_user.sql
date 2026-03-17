-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Helper function to delete a CRM user
--
-- Usage (from Supabase SQL Editor, as service_role):
--
--   SELECT delete_crm_user('cliente@email.com');
--
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_crm_user(
  p_email TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  DELETE FROM auth.users WHERE email = p_email;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN 'ERRORE: nessun utente trovato con email ' || p_email;
  END IF;

  RETURN 'Utente eliminato: ' || p_email;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_crm_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_crm_user(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.delete_crm_user(TEXT) FROM authenticated;
