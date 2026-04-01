# Data Model

## Principio generale

Quasi tutti i dati applicativi sono user-scoped. La regola di base è: un utente autenticato deve vedere e modificare solo i propri record.

## Tabelle principali

### `contacts`
Scopo: contatti CRM.
Campi notevoli:
- `user_id`
- campi anagrafici e commerciali
- `import_order`
- campi geolocalizzazione (`via`, `citta`, `provincia`, `stato`)

Policy attesa:
- select / insert / update / delete solo su record con `user_id = auth.uid()`

### `smtp_settings`
Scopo: configurazione SMTP/IMAP e profilo mittente.
Campi notevoli:
- `user_id`
- host, porta, credenziali
- dati mittente
- cartelle IMAP (`imap_sent_folder`, `imap_archive_folder`, `imap_trash_folder`, `imap_spam_folder`)

Policy attesa:
- una riga per utente
- accesso solo al proprietario

### `emails`
Scopo: cache / archivio email utente.
Campi notevoli:
- `user_id`
- `message_id`, `thread_id`, `folder`
- `starred`, `archived`, `spam`, `deleted_at`

Vincoli notevoli:
- unique composita su `(user_id, message_id)`

### `campaigns`
Scopo: stato campagne email.
Campi notevoli:
- `user_id`
- `status`
- `draft`
- `email_template`, `email_subject`
- `target_contacts`
- contatori `sent`, `total`, `failed`

### `calendar_events`
Scopo: eventi locali e sincronizzati.
Campi notevoli:
- `user_id`
- `google_event_id`
- `outlook_event_id`
- `contact_id`
- `meet_link`

### `google_calendar_tokens` / `outlook_calendar_tokens`
Scopo: token OAuth per provider calendario.
Campi notevoli:
- `user_id`
- `access_token`, `refresh_token`, `expires_at`

### `push_subscriptions`
Scopo: dispositivi/browser iscritti alle notifiche push.

### `push_queue`
Scopo: notifiche pianificate lato server.

### `email_sync_jobs`
Scopo: tracking sync email per utente/cartella.

## Regole per future modifiche

1. nuove colonne o tabelle → nuova migration
2. se la tabella è user-scoped, aggiungere `user_id` + policy coerenti
3. se cambiano i dati critici, aggiungere note di verifica
4. evitare policy permissive generiche (`USING (true)`) su tabelle private
