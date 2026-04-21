-- PressPulse Supabase schema (Postgres) + RLS + demo seed

create extension if not exists pgcrypto;

-- Enums
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sentiment_label') then
    create type sentiment_label as enum ('POSITIVE', 'NEUTRAL', 'NEGATIVE');
  end if;
end $$;

-- Workspaces
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null default 'owner',
  primary key (workspace_id, user_id)
);

-- RSS sources
create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null default 'rss',
  title text,
  url text not null,
  last_polled_at timestamptz,
  unique (workspace_id, url)
);

-- Articles
create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null,
  url text,
  source_name text,
  title text not null,
  language text not null check (language in ('en','fr','ar')),
  snippet text,
  published_at timestamptz,

  -- Latest analysis snapshot
  sentiment sentiment_label,
  confidence int check (confidence between 0 and 100),
  reasoning_native text,
  reasoning_en text,

  raw_text text,
  updated_at timestamptz not null default now(),

  unique (workspace_id, url)
);

create index if not exists idx_articles_workspace_created_at
  on public.articles (workspace_id, created_at desc);

create index if not exists idx_articles_workspace_sentiment
  on public.articles (workspace_id, sentiment);

create index if not exists idx_articles_workspace_language
  on public.articles (workspace_id, language);

-- Topics / Keywords (brands, campaigns, events, products)
create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  -- Free-form query string (e.g. "SIAM 2026" or "Air France OR AF")
  query text not null,
  -- Optional strict language scope (null = any)
  language text check (language in ('en','fr','ar')),
  is_active boolean not null default true,
  unique (workspace_id, name)
);

create table if not exists public.article_topics (
  article_id uuid not null references public.articles(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- How we matched (simple keyword / fts / manual)
  match_method text not null default 'keyword',
  primary key (article_id, topic_id)
);

create index if not exists idx_topics_workspace_active
  on public.topics (workspace_id, is_active);

create index if not exists idx_article_topics_topic
  on public.article_topics (topic_id, created_at desc);

create index if not exists idx_article_topics_article
  on public.article_topics (article_id);

-- Optional: full-text search over title/snippet/raw_text (English + French + Arabic-ish)
create extension if not exists pg_trgm;

create index if not exists idx_articles_title_trgm
  on public.articles using gin (title gin_trgm_ops);

create index if not exists idx_articles_snippet_trgm
  on public.articles using gin (snippet gin_trgm_ops);

create index if not exists idx_articles_raw_text_trgm
  on public.articles using gin (raw_text gin_trgm_ops);

create or replace function public.article_matches_query(p_article public.articles, p_query text)
returns boolean
language plpgsql
stable
as $$
begin
  -- Simple matcher: split by whitespace, require all tokens to appear in title/snippet/raw_text.
  -- This keeps it predictable for non-technical users and works across AR/FR/EN.
  return (
    select bool_and(
      coalesce(p_article.title, '') ilike '%' || token || '%'
      or coalesce(p_article.snippet, '') ilike '%' || token || '%'
      or coalesce(p_article.raw_text, '') ilike '%' || token || '%'
    )
    from regexp_split_to_table(trim(p_query), '\s+') as token
    where token <> ''
  );
end $$;

-- Update timestamps
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_articles_updated_at on public.articles;
create trigger trg_articles_updated_at
before update on public.articles
for each row execute function public.set_updated_at();

-- RLS
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.sources enable row level security;
alter table public.articles enable row level security;
alter table public.topics enable row level security;
alter table public.article_topics enable row level security;

-- Helper to check membership
create or replace function public.is_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
  );
$$;

-- Policies: workspaces visible if member
drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member"
on public.workspaces
for select
to authenticated
using (public.is_workspace_member(id, auth.uid()));

drop policy if exists "workspaces_insert_any" on public.workspaces;
create policy "workspaces_insert_any"
on public.workspaces
for insert
to authenticated
with check (true);

-- Members: user can see their memberships
drop policy if exists "members_select_self" on public.workspace_members;
create policy "members_select_self"
on public.workspace_members
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "members_insert_self" on public.workspace_members;
create policy "members_insert_self"
on public.workspace_members
for insert
to authenticated
with check (user_id = auth.uid());

-- Sources: member only
drop policy if exists "sources_select_member" on public.sources;
create policy "sources_select_member"
on public.sources
for select
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "sources_mutate_member" on public.sources;
create policy "sources_mutate_member"
on public.sources
for insert
to authenticated
with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "sources_update_member" on public.sources;
create policy "sources_update_member"
on public.sources
for update
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()))
with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "sources_delete_member" on public.sources;
create policy "sources_delete_member"
on public.sources
for delete
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()));

-- Articles: member only
drop policy if exists "articles_select_member" on public.articles;
create policy "articles_select_member"
on public.articles
for select
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "articles_insert_member" on public.articles;
create policy "articles_insert_member"
on public.articles
for insert
to authenticated
with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "articles_update_member" on public.articles;
create policy "articles_update_member"
on public.articles
for update
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()))
with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "articles_delete_member" on public.articles;
create policy "articles_delete_member"
on public.articles
for delete
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()));

-- Topics: member only
drop policy if exists "topics_select_member" on public.topics;
create policy "topics_select_member"
on public.topics
for select
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "topics_insert_member" on public.topics;
create policy "topics_insert_member"
on public.topics
for insert
to authenticated
with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "topics_update_member" on public.topics;
create policy "topics_update_member"
on public.topics
for update
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()))
with check (public.is_workspace_member(workspace_id, auth.uid()));

drop policy if exists "topics_delete_member" on public.topics;
create policy "topics_delete_member"
on public.topics
for delete
to authenticated
using (public.is_workspace_member(workspace_id, auth.uid()));

-- Article topics join: member only (via article.workspace_id)
drop policy if exists "article_topics_select_member" on public.article_topics;
create policy "article_topics_select_member"
on public.article_topics
for select
to authenticated
using (
  exists (
    select 1
    from public.articles a
    where a.id = article_topics.article_id
      and public.is_workspace_member(a.workspace_id, auth.uid())
  )
);

drop policy if exists "article_topics_insert_member" on public.article_topics;
create policy "article_topics_insert_member"
on public.article_topics
for insert
to authenticated
with check (
  exists (
    select 1
    from public.articles a
    join public.topics t on t.id = article_topics.topic_id
    where a.id = article_topics.article_id
      and a.workspace_id = t.workspace_id
      and public.is_workspace_member(a.workspace_id, auth.uid())
  )
);

drop policy if exists "article_topics_delete_member" on public.article_topics;
create policy "article_topics_delete_member"
on public.article_topics
for delete
to authenticated
using (
  exists (
    select 1
    from public.articles a
    where a.id = article_topics.article_id
      and public.is_workspace_member(a.workspace_id, auth.uid())
  )
);

-- Demo seed on first user signup
create or replace function public.handle_new_user_seed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  insert into public.workspaces(name)
  values ('Demo Workspace')
  returning id into v_workspace_id;

  insert into public.workspace_members(workspace_id, user_id, role)
  values (v_workspace_id, new.id, 'owner');

  -- Seed 3 demo articles (already analyzed)
  insert into public.articles(
    workspace_id,
    source_name,
    url,
    title,
    language,
    snippet,
    published_at,
    sentiment,
    confidence,
    reasoning_native,
    reasoning_en,
    raw_text
  ) values
  (
    v_workspace_id,
    'Gulf News',
    'https://example.com/dubai-expo-success-ar',
    'نجاح إكسبو دبي يعزز ثقة المستثمرين',
    'ar',
    'أشادت التقارير بالأثر الاقتصادي الإيجابي لإكسبو دبي على المنطقة...',
    now() - interval '2 days',
    'POSITIVE',
    92,
    'النص يستخدم تعابير مثل "يعزز" و"نجاح" و"ثقة المستثمرين" مما يشير إلى نبرة إيجابية واضحة.',
    'The text uses terms like “boosts”, “success”, and “investor confidence”, indicating a clearly positive tone.',
    'نجاح إكسبو دبي يعزز ثقة المستثمرين...'
  ),
  (
    v_workspace_id,
    'Le Monde',
    'https://example.com/air-france-strikes-fr',
    'Grèves chez Air France : des perturbations majeures attendues',
    'fr',
    'Les syndicats annoncent une nouvelle vague de grèves, provoquant annulations et retards...',
    now() - interval '1 day',
    'NEGATIVE',
    94,
    'Le texte emploie un vocabulaire alarmant ("perturbations majeures", "annulations", "retards") indiquant une tonalité négative.',
    'The text uses alarming terms like “major disruptions”, “cancellations”, and “delays”, indicating a negative outlook.',
    'Grèves chez Air France : des perturbations majeures attendues...'
  ),
  (
    v_workspace_id,
    'TechWire',
    'https://example.com/tech-acquisition-en',
    'Acme Corp announces acquisition of BetaSoft',
    'en',
    'The acquisition is expected to close next quarter, pending regulatory approval...',
    now() - interval '6 hours',
    'NEUTRAL',
    78,
    'The text is primarily factual and forward-looking (timelines, approvals) without strong emotional or evaluative language.',
    'The text is primarily factual and forward-looking (timelines, approvals) without strong emotional or evaluative language.',
    'Acme Corp announces acquisition of BetaSoft...'
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_presspulse on auth.users;
create trigger on_auth_user_created_presspulse
after insert on auth.users
for each row execute procedure public.handle_new_user_seed();

