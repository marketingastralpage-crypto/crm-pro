do $$
declare
  v_template_id uuid;
  v_version_id uuid;
  v_clause_id uuid;
begin
  insert into public.contract_templates (
    scope,
    owner_user_id,
    slug,
    name,
    description,
    contract_type,
    status
  )
  values (
    'platform',
    null,
    'platform-service-agreement-it',
    'Bozza contratto servizi continuativi',
    'Template dimostrativo in italiano da verificare con il proprio consulente legale prima dell’uso.',
    'service_agreement',
    'published'
  )
  on conflict (slug) where (scope = 'platform') do update
  set
    name = excluded.name,
    description = excluded.description,
    contract_type = excluded.contract_type,
    status = excluded.status,
    updated_at = now()
  returning id into v_template_id;

  insert into public.contract_template_versions (
    template_id,
    version_number,
    status,
    questionnaire_schema,
    composition_schema,
    render_schema,
    default_values,
    locale,
    jurisdiction,
    published_at
  )
  values (
    v_template_id,
    1,
    'published',
    '{
      "steps": [
        {
          "id": "counterparty",
          "title": "Controparte",
          "description": "Raccogli i dati essenziali del cliente e del referente firmatario.",
          "fields": [
            { "name": "counterparty_company", "label": "Ragione sociale cliente", "type": "text", "required": true, "placeholder": "Cliente S.r.l." },
            { "name": "counterparty_representative", "label": "Rappresentante cliente", "type": "text", "required": true, "placeholder": "Mario Rossi" },
            { "name": "counterparty_address", "label": "Indirizzo cliente", "type": "text", "required": true, "placeholder": "Via Milano 12, Milano" }
          ]
        },
        {
          "id": "services",
          "title": "Servizi e corrispettivo",
          "description": "Definisci l’oggetto del contratto e i parametri economici principali.",
          "fields": [
            { "name": "service_name", "label": "Nome dell’incarico", "type": "text", "required": true, "placeholder": "Gestione lead generation" },
            { "name": "services", "label": "Servizi inclusi", "type": "repeatable", "required": true, "placeholder": "Audit campagne" },
            { "name": "monthly_fee", "label": "Canone mensile", "type": "currency", "required": true, "min": 0 },
            { "name": "term_months", "label": "Durata in mesi", "type": "number", "required": true, "min": 1 },
            { "name": "payment_terms", "label": "Termini di pagamento", "type": "text", "required": true, "placeholder": "Bonifico a 30 giorni data fattura" }
          ]
        },
        {
          "id": "clauses",
          "title": "Clausole operative",
          "description": "Scegli i dati che pilotano durata, rinnovo e foro competente.",
          "fields": [
            { "name": "start_date", "label": "Decorrenza", "type": "date", "required": true },
            { "name": "notice_days", "label": "Preavviso recesso (giorni)", "type": "number", "required": true, "min": 0 },
            { "name": "forum_city", "label": "Foro competente", "type": "text", "required": true, "placeholder": "Bologna" },
            { "name": "include_report_clause", "label": "Includi reportistica periodica", "type": "checkbox", "checkboxLabel": "Il fornitore consegna un report periodico", "required": false }
          ]
        }
      ]
    }'::jsonb,
    '{
      "computed": {
        "services_html": { "op": "html_list", "path": "services" },
        "monthly_fee_display": { "op": "currency_format", "path": "monthly_fee", "locale": "it-IT", "currency": "EUR" },
        "contract_value_number": { "op": "multiply", "values": [{ "path": "monthly_fee" }, { "path": "term_months" }], "precision": 2 },
        "contract_value": { "op": "currency_format", "path": "computed.contract_value_number", "locale": "it-IT", "currency": "EUR" },
        "start_date_display": { "op": "date_format", "path": "start_date", "locale": "it-IT" }
      },
      "sections": [
        {
          "id": "parties",
          "title": "Parti",
          "body_html": "<p>Tra <strong>{{legal.registered_name}}</strong>, con sede in {{legal.address_line1}} {{legal.city}} {{legal.province}}, P.IVA {{legal.vat_number}}, rappresentata da {{legal.representative_name}} in qualità di {{legal.representative_role}} (di seguito, il <strong>Fornitore</strong>) e <strong>{{counterparty_company}}</strong>, con sede in {{counterparty_address}}, rappresentata da {{counterparty_representative}} (di seguito, il <strong>Cliente</strong>).</p>"
        },
        {
          "id": "scope",
          "title": "Oggetto",
          "body_html": "<p>Il Fornitore si impegna a svolgere l’incarico <strong>{{service_name}}</strong> e a fornire al Cliente le seguenti attività:</p><ul>{{computed.services_html}}</ul>"
        },
        {
          "id": "fees",
          "title": "Corrispettivo",
          "body_html": "<p>Il Cliente corrisponderà al Fornitore un canone pari a <strong>{{computed.monthly_fee_display}}</strong> al mese per una durata iniziale di <strong>{{term_months}}</strong> mesi, per un valore complessivo stimato pari a <strong>{{computed.contract_value}}</strong>.</p><p>I pagamenti avverranno secondo la seguente formula: {{payment_terms}}.</p>"
        },
        {
          "id": "duration",
          "title": "Durata e recesso",
          "body_html": "<p>Il presente accordo decorre dal <strong>{{computed.start_date_display}}</strong>. Ciascuna parte potrà recedere con un preavviso scritto di almeno <strong>{{notice_days}}</strong> giorni.</p>"
        },
        {
          "id": "reporting",
          "title": "Reportistica",
          "condition": { "op": "eq", "path": "include_report_clause", "value": true },
          "body_html": "<p>Il Fornitore mette a disposizione del Cliente una reportistica periodica sullo stato di avanzamento delle attività e sui principali indicatori di performance concordati.</p>"
        },
        {
          "id": "jurisdiction",
          "title": "Foro competente",
          "body_html": "<p>Per qualsiasi controversia derivante dal presente contratto sarà competente in via esclusiva il Foro di <strong>{{forum_city}}</strong>, salvo diverso accordo scritto tra le parti.</p>"
        }
      ]
    }'::jsonb,
    '{
      "subtitle": "Documento strutturato per preview HTML e pipeline export.",
      "footer_note": "Template dimostrativo della libreria piattaforma. Validare sempre testo, allegati e giurisdizione con il proprio consulente legale."
    }'::jsonb,
    '{
      "notice_days": 30,
      "forum_city": "Bologna",
      "include_report_clause": true
    }'::jsonb,
    'it-IT',
    'IT',
    now()
  )
  on conflict (template_id, version_number) do update
  set
    status = excluded.status,
    questionnaire_schema = excluded.questionnaire_schema,
    composition_schema = excluded.composition_schema,
    render_schema = excluded.render_schema,
    default_values = excluded.default_values,
    locale = excluded.locale,
    jurisdiction = excluded.jurisdiction,
    published_at = excluded.published_at
  returning id into v_version_id;

  update public.contract_templates
  set current_version_id = v_version_id, status = 'published', updated_at = now()
  where id = v_template_id;

  insert into public.contract_clause_blocks (
    scope,
    owner_user_id,
    slug,
    name,
    contract_type,
    locale,
    jurisdiction,
    status
  )
  values (
    'platform',
    null,
    'platform-confidentiality-it',
    'Clausola riservatezza standard',
    'service_agreement',
    'it-IT',
    'IT',
    'approved'
  )
  on conflict (slug) where (scope = 'platform') do update
  set
    name = excluded.name,
    status = excluded.status,
    updated_at = now()
  returning id into v_clause_id;

  insert into public.contract_clause_block_versions (
    clause_block_id,
    version_number,
    status,
    body_html,
    metadata,
    variable_slots,
    published_at
  )
  values (
    v_clause_id,
    1,
    'approved',
    '<p>Ciascuna parte si impegna a mantenere riservate le informazioni confidenziali ricevute dall’altra parte e a utilizzarle esclusivamente per l’esecuzione del rapporto contrattuale.</p>',
    '{"title":"Riservatezza"}'::jsonb,
    '[]'::jsonb,
    now()
  )
  on conflict (clause_block_id, version_number) do update
  set
    status = excluded.status,
    body_html = excluded.body_html,
    metadata = excluded.metadata,
    variable_slots = excluded.variable_slots,
    published_at = excluded.published_at;
end
$$;
