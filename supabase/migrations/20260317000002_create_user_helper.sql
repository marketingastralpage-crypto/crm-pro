-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Helper function to create CRM users
--
-- Usage (from Supabase SQL Editor, as service_role):
--
--   SELECT create_crm_user('cliente@email.com', 'PasswordSicura123!');
--
-- Questo crea un utente nell'auth di Supabase senza invio di email di conferma.
-- Le credenziali vanno comunicate manualmente al cliente.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_crm_user(
  p_email    TEXT,
  p_password TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Insert directly into auth.users (requires service_role)
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    role,
    aud,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token
  )
  VALUES (
    gen_random_uuid(),
    '00000000-0000-0000-0000-000000000000',
    p_email,
    crypt(p_password, gen_salt('bf')),
    now(),           -- email già confermata, nessuna email di verifica
    'authenticated',
    'authenticated',
    now(),
    now(),
    '',
    ''
  )
  RETURNING id INTO v_user_id;

  RETURN 'Utente creato: ' || p_email || ' (id: ' || v_user_id::text || ')';
EXCEPTION
  WHEN unique_violation THEN
    RETURN 'ERRORE: esiste già un utente con email ' || p_email;
  WHEN OTHERS THEN
    RETURN 'ERRORE: ' || SQLERRM;
END;
$$;

-- Revoca accesso pubblico: solo service_role può chiamare questa funzione
REVOKE ALL ON FUNCTION public.create_crm_user(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_crm_user(TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.create_crm_user(TEXT, TEXT) FROM authenticated;
