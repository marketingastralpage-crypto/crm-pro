# Repo Map

## Visione d'insieme

Questo progetto è un CRM SaaS basato su una SPA vanilla in `index.html` e su Supabase come backend.

## File e cartelle chiave

### Frontend
- `index.html`
  - contiene UI, CSS, stato globale, routing, rendering, import/export, email, campagne, calendario
- `manifest.json`
  - configurazione PWA
- `sw.js`
  - service worker
- `astralpage_logo.svg`
  - asset logo

### Backend / dati
- `supabase/migrations/*.sql`
  - evoluzione schema e policy
- `supabase/functions/*/index.ts`
  - funzioni server-side
- `run_migrations.js`
  - helper locale per migrazioni
- `supabase/DEV_GUIDE.md`
  - procedure manuali admin

### CI / deploy
- `.github/workflows/deploy-functions.yml`
  - deploy automatico Edge Functions su push a `master`

## Mappa logica di `index.html`

### Bootstrap / auth / navigation
- `showLoginScreen`, `handleLogin`, `handleLogout`
- `init`, `bootApp`
- `navigate`, `updateTopbar`, `renderView`

### Viste principali
- `renderDashboard`
- `renderContacts`
- `renderContactsSpreadsheet`
- `renderPipeline`
- `renderEmail`
- `renderSettings`
- `renderCampaigns`
- `renderCalendar`

### Operazioni trasversali
- import/export CSV/XLSX
- notifiche push
- SMTP / email sync
- campagne email
- integrazione Google / Outlook Calendar

## Regola di esplorazione

Quando lavori sul progetto:
1. individua l'area
2. trova la funzione entrypoint
3. leggi solo il blocco locale
4. evita di ricaricare l'intero file monolitico
