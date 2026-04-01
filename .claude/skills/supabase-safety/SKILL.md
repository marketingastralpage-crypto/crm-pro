---
name: supabase-safety
description: Skill per lavorare su migrazioni, RLS, auth e dati utente in Supabase senza introdurre regressioni di sicurezza.
user-invocable: true
allowed-tools: Read, Edit, Write, Glob, Grep
paths:
  - supabase/**
  - run_migrations.js
model: sonnet
---

# Supabase Safety

Usa questa skill per modifiche a schema, policy, auth helper e flussi che toccano dati utente.

## Regole obbligatorie

1. Non modificare vecchie migration già applicate: crea una nuova migration.
2. Ogni tabella utente deve avere ownership chiara (`user_id`) e policy coerenti con `auth.uid()`.
3. Non fidarti mai di `user_id` passato dal client.
4. Non esporre service role, secret o token nel frontend.
5. Se una Edge Function agisce su dati utente con service role, prima verifica il JWT.

## Checklist per ogni change

- schema change necessario?
- backfill richiesto?
- policy RLS coerenti?
- index da aggiungere?
- documentazione `docs/data-model.md` aggiornata?

## Attenzione speciale in questo repo

Storicamente ci sono già stati fix su policy troppo permissive (`USING (true)`).
Evita di reintrodurre pattern simili.

## Output atteso

- nuova migration proposta
- impatto su dati esistenti
- rischio sicurezza
- query o test di verifica
