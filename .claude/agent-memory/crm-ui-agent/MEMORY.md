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
- `renderCampaignWizard` (~riga 4200) → wizard creazione campagna (Q1-Q10, `campaignDraft`).
- `renderCampaignEditor` (~riga 4405) → anteprima destinatari, applica filtri e limite `max_contatti`.
- `validateCampaignForm` (~riga 4316) → validazione wizard prima di passare all'editor.

## Note campagne
- `campaignDraft` è lo stato globale del wizard.
- Il campo `max_contatti` (Q10) è opzionale; il limite viene applicato in `renderCampaignEditor` con `.slice(0, maxContatti)` dopo i filtri ruolo/stage.
