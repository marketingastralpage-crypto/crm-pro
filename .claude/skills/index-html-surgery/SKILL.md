---
name: index-html-surgery
description: Skill per modificare index.html in modo chirurgico, leggendo solo la slice necessaria e preservando comportamento e stile.
user-invocable: true
allowed-tools: Read, Edit, Write, Glob, Grep
paths:
  - index.html
model: sonnet
---

# Index HTML Surgery

`index.html` è il punto più costoso del repository. Questa skill serve a lavorarci senza sprecare contesto.

## Regole obbligatorie

1. Non caricare l'intero file salvo refactor trasversali inevitabili.
2. Parti da `grep` sul nome funzione, id DOM, variabile di stato o testo UI.
3. Apri solo il blocco locale della funzione e gli helper vicini.
4. Mantieni inalterati:
   - design tokens in `:root`
   - naming degli stati globali esistenti
   - semantica delle viste già presenti
5. Se una modifica richiede più aree, spezzala in sotto-task.

## Sequenza consigliata

1. Trova la funzione entrypoint della vista.
2. Leggi 100-250 righe attorno al blocco rilevante.
3. Individua helper, stato globale e query Supabase coinvolti.
4. Fai la patch minima.
5. Cerca riferimenti aggiuntivi con grep, senza riaprire tutto il file.

## Quando estrarre codice

Puoi proporre un'estrazione in file separati solo se:
- la porzione è chiaramente isolabile
- il rischio di regressione è basso
- il task include anche un miglioramento strutturale

## Output atteso

- funzione toccata
- rischio locale
- eventuali dipendenze collaterali
- come testare da browser
