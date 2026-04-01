---
name: edge-functions
description: Skill per Edge Functions Supabase del CRM SaaS. Mantiene auth, input validation e separazione client/server corrette.
user-invocable: true
allowed-tools: Read, Edit, Write, Glob, Grep
paths:
  - supabase/functions/**
model: sonnet
---

# Edge Functions

Usa questa skill per funzioni come SMTP, IMAP, Google Calendar, Outlook Calendar, Groq e push notifications.

## Regole obbligatorie

1. Valida sempre il body ricevuto.
2. Non fidarti di campi identità inviati dal client.
3. Se usi service role, verifica prima l'utente tramite JWT quando il comportamento è user-scoped.
4. Non loggare token, password, refresh token o secret.
5. Mantieni CORS coerente e minimale.
6. Tratta i provider esterni come fallibili: errori chiari, niente crash silenziosi.

## Controlli rapidi

- auth presente?
- input validato?
- query filtrate sullo user corretto?
- risposta consistente lato client?
- env richieste documentate?

## Output atteso

- funzione toccata
- rischio auth / provider
- patch minima
- test manuale o curl suggerito
