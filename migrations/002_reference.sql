-- Reference / catalog data. Seeded, read-only for learners, full CRUD for admin.
-- NOTE: we store problem metadata and a link only. Never the problem statement.

create table topic (
  id          bigint generated always as identity primary key,
  slug        text not null unique,
  name        text not null,
  blurb       text,
  sort_order  integer not null default 0
);

-- Self-referencing prerequisite relation. Acyclicity is enforced in the app
-- (a cycle check on write), not in SQL -- see server/src/repos/topic.js.
create table topic_prereq (
  topic_id        bigint not null references topic(id) on delete cascade,
  prereq_topic_id bigint not null references topic(id) on delete cascade,
  primary key (topic_id, prereq_topic_id),
  constraint topic_prereq_not_self check (topic_id <> prereq_topic_id)
);
create index topic_prereq_prereq_idx on topic_prereq(prereq_topic_id);

create table pattern (
  id          bigint generated always as identity primary key,
  topic_id    bigint not null references topic(id) on delete restrict,
  slug        text not null unique,
  name        text not null,
  explainer   text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index pattern_topic_idx on pattern(topic_id);
create trigger pattern_touch before update on pattern
  for each row execute function set_updated_at();

-- The graduated hint ladder, authored by hand. Revealed in order by the UI.
create table pattern_hint (
  id          bigint generated always as identity primary key,
  pattern_id  bigint not null references pattern(id) on delete cascade,
  level       smallint not null check (level between 1 and 3),
  body        text not null,
  unique (pattern_id, level)
);

create table problem (
  id          bigint generated always as identity primary key,
  slug        text not null unique,
  title       text not null,
  difficulty  text not null check (difficulty in ('easy','medium','hard')),
  url         text not null,
  topic_id    bigint not null references topic(id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index problem_topic_idx      on problem(topic_id);
create index problem_difficulty_idx on problem(difficulty);
create trigger problem_touch before update on problem
  for each row execute function set_updated_at();

create table problem_pattern (
  problem_id  bigint not null references problem(id) on delete cascade,
  pattern_id  bigint not null references pattern(id) on delete cascade,
  is_primary  boolean not null default false,
  primary key (problem_id, pattern_id)
);
create index problem_pattern_pattern_idx on problem_pattern(pattern_id);
create unique index problem_pattern_one_primary
  on problem_pattern(problem_id) where is_primary;
