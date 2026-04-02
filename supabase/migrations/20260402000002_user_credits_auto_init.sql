-- Crea automaticamente una riga in user_credits (credits = 0) per ogni nuovo utente

create or replace function public.init_user_credits()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  insert into public.user_credits (user_id, credits)
  values (new.id, 0)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- Trigger su auth.users: scatta dopo ogni INSERT (nuova registrazione)
drop trigger if exists trg_init_user_credits on auth.users;
create trigger trg_init_user_credits
  after insert on auth.users
  for each row execute function public.init_user_credits();

-- Inizializza anche gli utenti già esistenti che non hanno ancora una riga
insert into public.user_credits (user_id, credits)
select id, 0
from auth.users
on conflict (user_id) do nothing;
