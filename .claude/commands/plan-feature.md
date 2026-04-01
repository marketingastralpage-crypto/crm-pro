---
description: Pianifica una feature o un refactor in modo a basso contesto per questo CRM SaaS
model: sonnet
---

# Plan Feature

Pianifica la richiesta dell'utente senza fare subito un rewrite esteso.

## Obiettivo

Trasforma la richiesta in un piano implementabile a slice piccole, esplicitando:
- area del repo coinvolta
- file da leggere davvero
- rischi su dati, UI o auth
- ordine delle modifiche
- criterio di verifica

## Procedura

1. Leggi prima `CLAUDE.md` e i documenti `docs/` rilevanti.
2. Non aprire tutto `index.html`: usa ricerca mirata e leggi solo il blocco necessario.
3. Scegli una sola area primaria:
   - UI client → `index-html-surgery`
   - schema / RLS → `supabase-safety`
   - Edge Functions → `edge-functions`
4. Produci un piano diviso in slice che possano stare in una singola sessione senza saturare il contesto.
5. Se il task è grande, proponi checkpoint espliciti per usare `/compact`.

## Formato output

- Obiettivo
- Area del repo
- File da toccare
- Rischi
- Piano step-by-step
- Verifica finale
- Punto consigliato per `/compact`
