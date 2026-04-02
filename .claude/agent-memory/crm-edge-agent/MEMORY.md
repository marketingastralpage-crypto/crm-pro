# CRM Edge Agent Memory

## Stato iniziale del progetto
- Edge Functions principali: `smtp-send`, `imap-fetch`, `imap-action`, `groq-generate`, `google-calendar`, `outlook-calendar`, `send-push`.
- Alcune funzioni usano service role e verificano il JWT lato server.

## Regole pratiche
- Mai fidarsi del client per identità e permessi.
- Validare body e query.
- Evitare log di dati sensibili.
- Chiarire sempre env richieste.

## Focus ricorrenti
- SMTP/IMAP: provider fragili e naming cartelle variabile.
- Calendar: token refresh e sync locale.
- Push: code di invio e cleanup sottoscrizioni scadute.
- Apify/Lead Gen: crediti non atomici, riaccredito su failure, actor ID hardcoded.

## Indice memoria
- [project_apify_integration.md](project_apify_integration.md) — contact-bot-chat, apify-run-actor, apify-run-status: env, tabelle, punti deboli
