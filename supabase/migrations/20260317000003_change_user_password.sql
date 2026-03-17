-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Helper function to change a CRM user's password
--
-- Usage (from Supabase SQL Editor, as service_role):
--
--   SELECT change_crm_password('cliente@email.com', 'NuovaPassword456!');
--
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.change_crm_password(
  p_email       TEXT,
  p_new_password TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT;
BEGIN
  UPDATE auth.users
  SET
    encrypted_password = crypt(p_new_password, gen_salt('bf')),
    updated_at         = now()
  WHERE email = p_email;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN 'ERRORE: nessun utente trovato con email ' || p_email;
  END IF;

  RETURN 'Password aggiornata per: ' || p_email;
END;
$$;

REVOKE ALL ON FUNCTION public.change_crm_password(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_crm_password(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.change_crm_password(TEXT, TEXT) FROM authenticated;
