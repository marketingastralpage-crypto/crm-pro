---
name: Apify + Contact Generation Integration
description: Pattern, env e punti deboli delle 3 Edge Functions per generazione lead B2B (contact-bot-chat, apify-run-actor, apify-run-status)
type: project
---

## Funzioni create (2026-04-02)

- `contact-bot-chat` — chat LLM Groq per estrarre location/industry in linguaggio naturale
- `apify-run-actor` — verifica crediti, avvia run Apify, scala crediti, crea job
- `apify-run-status` — polling stato run Apify, fetch dataset, riaccredito su failure

## Auth pattern usato

Tutte e 3 le funzioni seguono il pattern di `groq-generate`:
- `createClient` con service role key
- `supa.auth.getUser(jwt)` per validare il JWT prima di qualsiasi operazione
- `uid = user.id` ricavato server-side, mai dal client

## Env richieste

- `GROQ_API_KEY` — già presente, usato da contact-bot-chat
- `APIFY_TOKEN` — nuovo, necessario per apify-run-actor e apify-run-status
- `SUPABASE_URL` — già presente
- `SUPABASE_SERVICE_ROLE_KEY` — già presente

## Tabelle DB necessarie (da migrare)

- `user_credits` — colonne: `user_id`, `credits`, `updated_at`
- `contact_gen_jobs` — colonne: `id`, `user_id`, `apify_run_id`, `location_en`, `industry_en`, `count_requested`, `credits_used`, `status`, `result_snapshot`, `updated_at`

## Punti deboli e attenzioni

1. **Riaccredito su failure in apify-run-status**: usa `rpc('increment_credits', ...)` con fallback a lettura+update diretto. Se la RPC non esiste, il fallback funziona ma non è atomico — race condition teorica se più polling simultanei. Verificare se la RPC esiste o aggiungere la migration con la funzione SQL atomica.

2. **Apify actor ID hardcoded**: `IoSHqwTR9YGhzccez` — se l'actor viene clonato o aggiornato, aggiornare la costante in `apify-run-actor/index.ts`.

3. **Dataset limit fisso a 500**: in `apify-run-status` il fetch items ha `limit=500`. Se `count_requested > 500` (già bloccato lato input) non è un problema, ma da tenere allineato.

4. **Crediti non atomici**: la sequenza "leggi crediti → chiama Apify → scala crediti" in `apify-run-actor` non è in una transazione. Se Apify risponde OK ma l'UPDATE dei crediti fallisce, l'utente usa il run gratuitamente. Mitigazione: aggiungere gestione dell'errore con retry o usare una Postgres function transazionale.

5. **contact-bot-chat è stateless**: tutta la history viene inviata ad ogni call. Con conversazioni lunghe si avvicina al token limit di Groq (max_tokens=400 per la risposta, ma i tokens in input crescono).

**Why:** Documentato per future manutenzioni e per sapere cosa migrare prima del go-live.
**How to apply:** Prima di rilasciare, verificare che `user_credits` e `contact_gen_jobs` abbiano le migration, e valutare se aggiungere la RPC `increment_credits` per rendere atomico il riaccredito.
