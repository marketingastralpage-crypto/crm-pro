# Come usare Claude Code su questo progetto

## Obiettivo

Far lavorare Claude bene su un repo monolitico senza consumare troppo velocemente il contesto.

## Regola più importante

Non chiedere mai modifiche generiche tipo:
- "migliora tutta la UI"
- "controlla tutto index.html"
- "rifattorizza il CRM"

Meglio richieste strette, ad esempio:
- "sistema il filtro contatti nella vista spreadsheet"
- "controlla perché il reply email non salva il thread_id"
- "aggiungi una migration per rendere unico X"

## Workflow consigliato

### 1. Parti in plan mode
Usa `/plan` o il comando custom `plan-feature` quando il task non è banale.

### 2. Dai un perimetro preciso
Specifica sempre:
- area: UI, Supabase o Edge Function
- outcome atteso
- file se già lo conosci
- cosa NON deve essere toccato

### 3. Fai task piccoli
Un task ideale tocca:
- una vista
- una funzione
- una migration
- una edge function

### 4. Compatta spesso
Se la sessione diventa lunga o tocca più sotto-problemi, usa `/compact`.
Punto pratico: fallo dopo ogni bug risolto o dopo ogni slice completata.

### 5. Riavvia il contesto quando cambi area
Se passi da UI a RLS o da campagne a calendario, meglio nuova sessione o `/clear` + nuovo task.

## Comandi utili

- `/plan` → per pianificare senza scrivere subito
- `/compact` → per comprimere la sessione
- `/clear` → per cambiare totalmente task
- `/memory` → per controllare la memoria del progetto
- `/agents` → per usare agenti specializzati
- `/skills` → per richiamare skill mirate

## Agenti consigliati in questo repo

- `crm-ui-agent` → UI client in `index.html`
- `crm-data-agent` → Supabase, schema, RLS
- `crm-edge-agent` → Edge Functions e provider esterni

## Skill consigliate

- `crm-repo-map`
- `index-html-surgery`
- `supabase-safety`
- `edge-functions`

## Prompt template consigliato

Usa questo formato:

```text
Task: [cosa vuoi ottenere]
Area: [UI | Supabase | Edge Function]
File sospetti: [se li conosci]
Vincoli: [cosa non rompere]
Done when: [criterio di completamento]
Lavora in modo chirurgico e non leggere tutto index.html se non serve.
```
