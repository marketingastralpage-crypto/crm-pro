# Gestione Accessi CRM — Guida Developer

## Come applicare le migrazioni

1. Apri **Supabase Dashboard → SQL Editor**
2. Esegui i file nella cartella `migrations/` in ordine numerico

---

## Creare un nuovo account cliente

Dal **Supabase SQL Editor** (con il tuo account che ha permessi `service_role`):

```sql
SELECT create_crm_user('cliente@email.com', 'PasswordSicura123!');
```

Comunica email e password al cliente via canale sicuro (es. telefono o messaggio cifrato).

---

## Cambiare la password di un utente

```sql
SELECT change_crm_password('cliente@email.com', 'NuovaPassword456!');
```

---

## Eliminare un account

```sql
SELECT delete_crm_user('cliente@email.com');
```

---

## Visualizzare tutti gli utenti attivi

```sql
SELECT id, email, created_at, last_sign_in_at
FROM auth.users
ORDER BY created_at DESC;
```

---

## Note di sicurezza

- Le funzioni di gestione utenti sono accessibili **solo come service_role** (non dal browser).
- La chiave `sb_publishable_*` esposta in `index.html` è la **anon key**: non ha accesso ad `auth.users`.
- Le tabelle `contacts` e `smtp_settings` sono protette da RLS: solo utenti autenticati possono leggerle/scriverle.
- Non esiste registrazione pubblica né recupero password self-service: tutto è gestito dal developer.
