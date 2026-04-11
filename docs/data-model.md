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

### `habit_month_entries`
Scopo: snapshot mensili del Habit Tracker per utente.
Campi notevoli:
- `user_id`
- `habit_uid` stabile tra mesi
- `month_start` come `date` locale del mese
- `mode` in `daily | weekly`
- `goal`, `sort_order`, `archived`
- `completion_slots` come array jsonb di chiavi (`d1`, `d2`, `w1`, ...)

Vincoli notevoli:
- unique composita su `(user_id, habit_uid, month_start)`
- `goal > 0`
- `sort_order >= 0`
- `completion_slots` deve essere un array JSON

Policy:
- select / insert / update / delete solo al proprietario (`user_id = auth.uid()`)

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

### `user_credits`
Scopo: saldo crediti per la generazione contatti via Apify.
Campi notevoli:
- `user_id` (PK, una riga per utente)
- `credits` (intero >= 0)
- `updated_at`

Policy:
- select solo al proprietario
- update solo al proprietario (le edge functions usano service role e bypassano RLS)

### `contact_gen_jobs`
Scopo: log dei job di generazione contatti (Apify).
Campi notevoli:
- `user_id`
- `apify_run_id`
- `location_en`, `industry_en`, `count_requested`
- `credits_used`
- `status` in ('pending','running','succeeded','failed')
- `result_snapshot` (jsonb)
- `contacts_imported`

Policy:
- select / insert / update solo al proprietario

### `contract_brand_profiles`
Scopo: token visivi e asset brand per la generazione contratti.
Campi notevoli:
- `user_id` (una riga per utente)
- `brand_name`
- `logo_asset_path`
- `accent_color`, `secondary_color`
- `header_variant`, `footer_variant`, `signature_layout`

### `organization_legal_profiles`
Scopo: anagrafica legale del fornitore da congelare nelle istanze contratto.
Campi notevoli:
- `user_id` (una riga per utente)
- `registered_name`, `vat_number`, `tax_code`
- indirizzo completo
- `representative_name`, `representative_role`
- `privacy_controller_text`, `forum_text`

### `contract_templates` / `contract_template_versions`
Scopo: metadata mutabili del template e versioni immutabili del questionario/composizione/rendering.
Campi notevoli:
- `scope` (`user` o `platform`)
- `owner_user_id`
- `slug`, `name`, `contract_type`, `status`
- `current_version_id`
- in `contract_template_versions`: `questionnaire_schema`, `composition_schema`, `render_schema`, `default_values`, `locale`, `jurisdiction`

### `contract_clause_blocks` / `contract_clause_block_versions`
Scopo: libreria di clausole riutilizzabili con versioni approvate.

### `contract_drafts`
Scopo: bozze in autosave del builder contratti.
Campi notevoli:
- `user_id`
- `template_id`, `template_version_id`
- `title`
- `answers`
- `preview_cache`
- `validation_state`
- `status`

### `contract_instances`
Scopo: snapshot immutabili del contratto composto.
Campi notevoli:
- `user_id`
- riferimenti a draft/template/versione
- `template_name`, `contract_type`, `title`
- snapshot `answers`, `computed_values`, `resolved_document`, `resolved_html`
- snapshot `brand_snapshot`, `legal_snapshot`
- `renderer_version`

### `contract_exports`
Scopo: output HTML/PDF associati a una specifica istanza contratto.
Campi notevoli:
- `user_id`
- `instance_id`
- `export_type`
- `storage_bucket`, `storage_path`
- `renderer_version`, `checksum`

## Regole per future modifiche

1. nuove colonne o tabelle → nuova migration
2. se la tabella è user-scoped, aggiungere `user_id` + policy coerenti
3. se cambiano i dati critici, aggiungere note di verifica
4. evitare policy permissive generiche (`USING (true)`) su tabelle private
5. per i contratti congelare sempre HTML e JSON risolti in `contract_instances`, senza rigenerare retroattivamente da template live
