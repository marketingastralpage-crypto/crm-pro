# Repo Map

## Visione d'insieme

Questo progetto è un CRM SaaS basato su una SPA vanilla in `index.html` e su Supabase come backend.

## File e cartelle chiave

### Frontend
- `index.html`
  - contiene UI, CSS, stato globale, routing, rendering, import/export, email, campagne, calendario
- `contracts/contract-ui.js`
  - slice no-build per libreria contratti, bozze, profili brand/legali, preview e storico
- `contracts/questionnaire-engine.js`
  - renderer browser-side del questionario strutturato e validazione step-based
- `contracts/contract-preview.css`
  - stile dedicato alla sezione contratti e alla preview HTML
- `contracts/shared/contract-engine.mjs`
  - motore deterministico condiviso per composizione, regole e test locali
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
- `supabase/functions/_shared/contracts.ts`
  - helper comuni per auth, cors, checksum e URL storage pubblici
- `supabase/functions/contract-compose/index.ts`
  - composizione server-side del contratto da template + risposte + profili
- `supabase/functions/contract-template-admin/index.ts`
  - CRUD amministrativo minimo per template e versioni
- `supabase/functions/contract-export/index.ts`
  - congelamento istanza, upload snapshot HTML e orchestrazione export
- `api/contracts/render-pdf.ts`
  - scaffold del runtime PDF Vercel; al momento restituisce `501` finché non viene aggiunto un renderer headless reale
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
- `renderContracts`
  - entrypoint del nuovo slice contratti caricato da file esterni

### Viste principali
- `renderDashboard`
- `renderContacts`
- `renderContactsSpreadsheet`
- `renderPipeline`
- `renderEmail`
- `renderSettings`
- `renderCampaigns`
- `renderHabitTracker`
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
