-- Annonsbesiktningen: leads, köp och administratörer.
-- Kör hela filen i Supabase › SQL Editor › New query › Run. Den går att köra flera gånger.

-- Administratörer: e-postadresser som får logga in och se leads.
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);

-- En lead = en granskning där besökaren lämnat e-post och samtycke.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null,
  company text,
  website text,
  consent_text text not null,              -- exakt den text besökaren godkände
  profile jsonb,                           -- svaren på startfrågorna
  audit jsonb,                             -- sammanfattning för listan i adminvyn
  result jsonb,                            -- hela protokollet (för att kunna öppna det och leverera efter köp)
  paid boolean not null default false,
  paid_at timestamptz
);
create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_email_idx on public.leads (lower(email));

-- Köp som verifierats mot Stripe. session_id är unikt så att samma betalning bara räknas en gång.
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id text not null unique,
  lead_id uuid references public.leads (id) on delete set null,
  email text,
  amount_total integer,
  currency text
);

-- Är den inloggade användaren admin? Kräver bekräftad e-post (magisk länk bekräftar den).
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) and coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, true);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

alter table public.admins enable row level security;
alter table public.leads enable row level security;
alter table public.purchases enable row level security;

-- Besökare kan inte läsa eller skriva tabellerna direkt. Leads och köp skrivs av Edge Functions
-- (submit-lead och verify-payment) med servernyckeln. Bara admins kan läsa.
drop policy if exists "admins läser admins" on public.admins;
create policy "admins läser admins" on public.admins for select to authenticated using (public.is_admin());

drop policy if exists "admins läser leads" on public.leads;
create policy "admins läser leads" on public.leads for select to authenticated using (public.is_admin());
drop policy if exists "admins raderar leads" on public.leads;
create policy "admins raderar leads" on public.leads for delete to authenticated using (public.is_admin());

drop policy if exists "admins läser köp" on public.purchases;
create policy "admins läser köp" on public.purchases for select to authenticated using (public.is_admin());

-- Radera leads äldre än 12 månader varje natt (samma tid som i samtyckestexten).
-- Kräver tillägget pg_cron (Database › Extensions). Om raden ger fel: aktivera pg_cron och kör om.
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'annonsbesiktning-rensa-leads';
select cron.schedule('annonsbesiktning-rensa-leads', '15 3 * * *',
  $$delete from public.leads where created_at < now() - interval '12 months'$$);

-- Lägg till dig själv som admin (byt till din e-post och kör raden):
-- insert into public.admins (email) values ('din@epost.se') on conflict do nothing;
