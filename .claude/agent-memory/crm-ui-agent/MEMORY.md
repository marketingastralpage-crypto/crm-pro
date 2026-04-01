# CRM UI Agent Memory

## Stato iniziale del progetto
- Frontend principale concentrato in `index.html`.
- Viste principali: dashboard, contacts, pipeline, email, settings, campaigns, calendario.
- Stato globale gestito con variabili top-level e rendering manuale.

## Regole pratiche
- Non leggere mai tutto `index.html` per bug locali.
- Cercare prima funzione e helper vicini.
- Preferire patch piccole e reversibili.

## Zone importanti
- `init`, `bootApp`, `navigate`, `renderView` → bootstrap e routing.
- `renderContacts` / `renderContactsSpreadsheet` → area contatti.
- `renderEmail` + sync helpers → area email.
- `renderCampaigns` → campagne.
- `renderCalendar` → calendario.
