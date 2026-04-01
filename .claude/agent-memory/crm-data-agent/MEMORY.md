# CRM Data Agent Memory

## Stato iniziale del progetto
- Supabase gestisce auth, contatti, email, campagne, calendario, notifiche.
- Esistono fix storici a policy troppo permissive.
- Ownership dati user-scoped basata su `user_id`.

## Regole pratiche
- Nuove modifiche schema = nuove migration append-only.
- Controllare sempre RLS e unique/index collegati.
- Aggiornare `docs/data-model.md` se cambia la struttura.

## Tabelle chiave
- `contacts`
- `smtp_settings`
- `emails`
- `calendar_events`
- `campaigns`
- `push_subscriptions`
- `push_queue`
- `email_sync_jobs`
