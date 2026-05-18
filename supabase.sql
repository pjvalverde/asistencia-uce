create table if not exists public.app_state (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

drop policy if exists "service_role_only_app_state" on public.app_state;

create policy "service_role_only_app_state"
on public.app_state
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
