# Roadmap di modularizzazione

## Perché serve

Il vero problema di contesto del progetto è `index.html` monolitico. Anche con buone istruzioni a Claude, il costo di lettura resta alto.

## Ordine consigliato

### Fase 1 — zero rischio
Estrarre in file separati:
- costanti statiche
- formatter helper
- utility CSV/XLSX
- notifiche / toast helper

### Fase 2 — bootstrap e stato
Estrarre:
- auth/login
- boot app
- router semplice delle viste

### Fase 3 — viste grandi
Separare una alla volta:
- contacts
- email
- campaigns
- calendar

### Fase 4 — data layer client
Centralizzare le chiamate Supabase lato client in moduli dedicati.

## Regola di esecuzione

Ogni estrazione deve:
- mantenere invariato il comportamento visibile
- essere reversibile
- toccare una sola area funzionale per volta
