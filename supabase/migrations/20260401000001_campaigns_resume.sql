-- Aggiunge colonne per la ripresa delle campagne e la diagnosi degli errori
alter table campaigns
  add column if not exists last_index int not null default -1,
  add column if not exists error_code text,
  add column if not exists error_detail text;
