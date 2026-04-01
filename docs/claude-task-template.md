# Template prompt per Claude Code

## Template breve

```text
Task: [obiettivo preciso]
Area: [UI | Supabase | Edge Function]
File sospetti: [facoltativo]
Vincoli: [cosa non toccare]
Done when: [risultato verificabile]
Lavora in modo chirurgico e con patch minima.
Non leggere tutto index.html se non è necessario.
```

## Esempi

### Bug UI
```text
Task: correggi il pulsante "Nuovo lead" nella vista contatti
Area: UI
File sospetti: index.html
Vincoli: non cambiare il layout generale
Done when: il pulsante apre il modal e salva il contatto correttamente
Lavora in modo chirurgico e con patch minima.
Non leggere tutto index.html se non è necessario.
```

### Modifica database
```text
Task: aggiungi una migration per salvare la timezone dell'utente nelle impostazioni
Area: Supabase
File sospetti: supabase/migrations, index.html
Vincoli: non modificare vecchie migration già applicate
Done when: esiste una nuova migration e il frontend salva/legge il campo
Lavora in modo chirurgico e con patch minima.
```

### Edge Function
```text
Task: controlla perché smtp-send fallisce quando manca il subject
Area: Edge Function
File sospetti: supabase/functions/smtp-send/index.ts
Vincoli: non cambiare il flusso auth esistente
Done when: la funzione valida l'input e restituisce errore chiaro
Lavora in modo chirurgico e con patch minima.
```
