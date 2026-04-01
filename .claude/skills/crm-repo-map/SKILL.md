---
name: crm-repo-map
description: Mappa rapida del repository CRM SaaS. Usala prima di esplorare il progetto o quando devi decidere quali file leggere.
user-invocable: true
allowed-tools: Read, Glob, Grep
model: haiku
---

# CRM Repo Map

Usa questa skill per orientarti rapidamente nel repository.

## Aree principali

- `index.html`
  - app SPA principale
  - contiene design system, stato globale, routing tra viste, rendering, import/export, email, campagne, calendario
- `supabase/migrations`
  - migrazioni append-only
  - RLS, auth helper, email, campagne, calendario, notifiche push
- `supabase/functions`
  - integrazioni server-side e provider esterni
- `docs/`
  - documentazione di contesto da leggere prima del codice grosso

## Regola operativa

Se il task riguarda una vista dell'app, NON leggere tutto `index.html`.
Prima cerca la funzione principale della vista e poi apri solo il blocco locale.

## Indizi utili

- `renderDashboard` → dashboard
- `renderContacts` / `renderContactsSpreadsheet` → rubrica / tabella
- `renderPipeline` → pipeline
- `renderEmail` → email e sync
- `renderCampaigns` → campagne
- `renderCalendar` → calendario
- `renderSettings` → configurazioni SMTP / notifiche
- `init`, `bootApp`, `navigate` → bootstrap e navigazione
