-- ---------------------------------------------------------------------------
-- User-owned data. Every read and write of these tables is scoped by user_id
-- in the data layer (server/src/repos/*). Tables without their own user_id
-- (goal_topic, plan_item, attempt_pattern) are reached only through a join to
-- their owning row.
-- ---------------------------------------------------------------------------

create table goal (
  id             bigint generated always as identity primary key,
  user_id        bigint not null references app_user(id) on delete cascade,
  target_date    date not null,
  hours_per_week numeric(4,1) not null check (hours_per_week > 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index goal_user_idx on goal(user_id);
create unique index goal_one_active_per_user on goal(user_id) where is_active;
create trigger goal_touch before update on goal
  for each row execute function set_updated_at();

create table goal_topic (
  goal_id  bigint not null references goal(id) on delete cascade,
  topic_id bigint not null references topic(id) on delete cascade,
  primary key (goal_id, topic_id)
);

create table plan (
  id         bigint generated always as identity primary key,
  user_id    bigint not null references app_user(id) on delete cascade,
  name       text not null,
  status     text not null default 'draft' check (status in ('draft','active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index plan_user_status_idx on plan(user_id, status);
create trigger plan_touch before update on plan
  for each row execute function set_updated_at();

-- No unique(plan_id, problem_id): a plan may hold the same problem twice, on
-- purpose, for a second pass. Re-practice is the whole retention story.
create table plan_item (
  id           bigint generated always as identity primary key,
  plan_id      bigint not null references plan(id) on delete cascade,
  problem_id   bigint not null references problem(id) on delete restrict,
  target_date  date,
  sort_order   integer not null,
  status       text not null default 'todo' check (status in ('todo','done','skipped')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint plan_item_completed_at_matches_status
    check ((status = 'done') = (completed_at is not null))
);
create index plan_item_plan_order_idx on plan_item(plan_id, sort_order);
create index plan_item_due_idx        on plan_item(plan_id, status, target_date);
create trigger plan_item_touch before update on plan_item
  for each row execute function set_updated_at();

create table attempt (
  id             bigint generated always as identity primary key,
  user_id        bigint not null references app_user(id) on delete cascade,
  problem_id     bigint not null references problem(id) on delete restrict,
  plan_item_id   bigint references plan_item(id) on delete set null,
  attempted_on   date not null,
  minutes_spent  integer not null check (minutes_spent > 0 and minutes_spent <= 600),
  outcome        text not null check (outcome in ('solved_clean','solved_with_hint','gave_up')),
  max_hint_level smallint not null default 0 check (max_hint_level between 0 and 3),
  confidence     smallint not null check (confidence between 1 and 5),
  reflection     text,
  -- true for the attempts logged by hand before the app existed (the baseline)
  is_baseline    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Keeps the hint-dependency metric from drifting: a "clean" solve cannot
  -- carry a hint, and a hinted solve must carry at least one.
  constraint attempt_hint_matches_outcome check (
    (outcome = 'solved_clean'     and max_hint_level = 0) or
    (outcome = 'solved_with_hint' and max_hint_level >= 1) or
    (outcome = 'gave_up')
  )
);
create index attempt_user_date_idx    on attempt(user_id, attempted_on desc);
create index attempt_user_problem_idx on attempt(user_id, problem_id, attempted_on);
create trigger attempt_touch before update on attempt
  for each row execute function set_updated_at();

-- Which pattern(s) you actually used, chosen at log time (prefilled from the
-- problem's tags). This is what the mastery grid counts -- not the problem's
-- tags -- so the grid measures technique practised rather than technique
-- intended. No user_id here on purpose: ownership comes from attempt.
create table attempt_pattern (
  attempt_id bigint not null references attempt(id) on delete cascade,
  pattern_id bigint not null references pattern(id) on delete restrict,
  primary key (attempt_id, pattern_id)
);
create index attempt_pattern_pattern_idx on attempt_pattern(pattern_id);

create table note (
  id         bigint generated always as identity primary key,
  user_id    bigint not null references app_user(id) on delete cascade,
  problem_id bigint references problem(id) on delete cascade,
  pattern_id bigint references pattern(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint note_exactly_one_parent
    check ((problem_id is not null) <> (pattern_id is not null))
);
create index note_user_problem_idx on note(user_id, problem_id) where problem_id is not null;
create index note_user_pattern_idx on note(user_id, pattern_id) where pattern_id is not null;
create trigger note_touch before update on note
  for each row execute function set_updated_at();

-- Current state only, one row per user x pattern, mutated in place.
-- Fixed ladder 1 -> 3 -> 7 -> 21 days: pass advances a step, fail resets to 1.
create table review (
  id               bigint generated always as identity primary key,
  user_id          bigint not null references app_user(id) on delete cascade,
  pattern_id       bigint not null references pattern(id) on delete cascade,
  interval_days    integer not null default 1 check (interval_days > 0),
  due_on           date not null,
  last_reviewed_on date,
  last_result      text check (last_result in ('pass','fail')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (user_id, pattern_id)
);
create index review_user_due_idx on review(user_id, due_on);
create trigger review_touch before update on review
  for each row execute function set_updated_at();
