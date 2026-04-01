# CLAUDE.md

Guida breve per lavorare su questo repository con Claude Code senza sprecare contesto.

## Scopo del progetto

CRM SaaS single-page per AstralPage.
Stack reale del repo:
- frontend in `index.html` (HTML + CSS + JS vanilla, app principale)
- backend su Supabase (`migrations/` + `functions/`)
- PWA (`manifest.json`, `sw.js`)
- helper locale `run_migrations.js`

## Mappa veloce del repo

- `index.html` → quasi tutta la UI e la logica client
- `supabase/migrations/*.sql` → schema, RLS, auth helper, campagne, email, calendario
- `supabase/functions/*/index.ts` → Edge Functions
- `supabase/DEV_GUIDE.md` → operazioni manuali di amministrazione utenti
- `.github/workflows/deploy-functions.yml` → deploy automatico funzioni
- `docs/repo-map.md` → mappa operativa più dettagliata
- `docs/data-model.md` → schema applicativo e ownership dati
- `docs/workflow-with-claude.md` → come usare Claude sul progetto

## Regole fondamentali per non consumare troppa memoria

1. **Non leggere `index.html` tutto insieme** salvo refactor trasversali.
2. Per task UI, trova prima la funzione con `grep`, poi leggi solo il blocco locale.
3. Lavora per slice piccole: una vista, un bug, una funzione, una migration.
4. Prima di scrivere, definisci: file toccati, rischio, validazione.
5. Dopo task lunghi o dopo più sotto-problemi, fai `/compact`.
6. Mantieni questa guida sotto ~200 linee; sposta i dettagli nei file `docs/` o nelle skill.

## Routing del lavoro

### Se il task riguarda UI / UX / flussi client
Usa la skill `index-html-surgery`.
Focus tipico:
- `renderDashboard`
- `renderContacts` / `renderContactsSpreadsheet`
- `renderPipeline`
- `renderEmail`
- `renderCampaigns`
- `renderCalendar`
- modali, filtri, stato globale e bootstrap

### Se il task riguarda database / RLS / auth
Usa la skill `supabase-safety`.
Regole:
- non modificare vecchie migration già applicate in produzione
- aggiungi nuove migration append-only
- ogni tabella utente deve rispettare `user_id = auth.uid()`
- mai esporre service role nel client

### Se il task riguarda Edge Functions
Usa la skill `edge-functions`.
Regole:
- valida input
- non fidarti del `user_id` dal client
- se usi service role, verifica il JWT lato server prima di agire per conto dell'utente
- non loggare segreti o token

## Convenzioni di modifica

- Mantieni coerente il design system già presente in `:root`.
- Evita grossi rewrite di `index.html` senza motivo.
- Preferisci estrazioni incrementali e reversibili.
- Se aggiungi una nuova area importante, aggiorna `docs/repo-map.md`.
- Se cambi lo schema dati, aggiorna `docs/data-model.md`.

## Strategia consigliata per task complessi

1. Identifica l'area corretta del repo.
2. Leggi solo file e funzioni strettamente necessarie.
3. Fai un piano breve con patch minima.
4. Implementa la slice.
5. Verifica impatti collaterali con ricerca mirata.
6. Compatta il contesto se il task continua.

## Refactor progressivo consigliato

Il principale problema del repo è `index.html` (~5600 righe). Quando possibile:
- estrai helper puri e costanti condivise
- separa le viste più grandi in file dedicati
- isola auth/bootstrap/stato globale
- lascia invariato il comportamento esterno mentre modularizzi

## Output atteso da Claude

Quando lavori su questo repo, restituisci sempre:
- file toccati
- patch minima proposta
- rischi o dipendenze
- come verificare la modifica
