---
description: Debug guidato per bug UI, Supabase o Edge Functions nel CRM SaaS
model: sonnet
---

# Debug CRM

Analizza un bug in modo chirurgico e a basso consumo di contesto.

## Regole

1. Parti sempre dalla riproduzione del bug.
2. Identifica subito l'area:
   - `index.html`
   - `supabase/migrations`
   - `supabase/functions`
3. Leggi solo il blocco locale del codice coinvolto.
4. Non proporre rewrite ampi se basta una patch minima.
5. Controlla effetti collaterali solo con ricerche mirate.

## Output richiesto

- Sintomo
- Causa probabile
- File e funzione coinvolti
- Patch minima consigliata
- Come verificare il fix
- Eventuale follow-up da fare dopo `/compact`
