-- PressPulse: SERP auto-discovery migration
-- Safe to run multiple times (idempotent via IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)

-- 1. Articles: track discovery source and domain authority
alter table public.articles
  add column if not exists discovered_via text not null default 'manual'
    check (discovered_via in ('manual', 'rss', 'serp', 'news')),
  add column if not exists domain_authority int
    check (domain_authority between 0 and 100),
  add column if not exists domain text;

create index if not exists idx_articles_workspace_authority
  on public.articles (workspace_id, domain_authority desc nulls last);

create index if not exists idx_articles_domain
  on public.articles (domain);

-- 2. Topics: auto-discovery config
alter table public.topics
  add column if not exists auto_discover boolean not null default true,
  add column if not exists last_discovered_at timestamptz,
  add column if not exists discover_interval_hours int not null default 6
    check (discover_interval_hours between 1 and 168);

-- 3. Topic runs: log every discovery run for observability + dedup
create table if not exists public.topic_runs (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'error', 'partial')),
  trigger text not null default 'cron'
    check (trigger in ('manual', 'cron', 'auto')),
  results_found int not null default 0,
  articles_created int not null default 0,
  articles_updated int not null default 0,
  error_message text
);

create index if not exists idx_topic_runs_topic_started
  on public.topic_runs (topic_id, started_at desc);

alter table public.topic_runs enable row level security;

drop policy if exists "topic_runs_select_member" on public.topic_runs;
create policy "topic_runs_select_member"
on public.topic_runs
for select
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()));

-- 4. Domain authority cache (avoid hammering Open PageRank)
create table if not exists public.domain_authority_cache (
  domain text primary key,
  authority int not null check (authority between 0 and 100),
  fetched_at timestamptz not null default now()
);

-- Cache entries expire after 30 days — caller checks fetched_at
create index if not exists idx_domain_authority_fetched_at
  on public.domain_authority_cache (fetched_at desc);
