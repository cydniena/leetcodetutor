create table app_user (
  id            bigint generated always as identity primary key,
  email         text not null,
  password_hash text not null,
  role          text not null default 'learner' check (role in ('learner','admin')),
  -- Every "what day is it" decision routes through this. See server/src/lib/dates.js;
  -- nothing in the codebase may call current_date / CURRENT_DATE directly.
  timezone      text not null default 'UTC',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login_at timestamptz
);
-- Case-insensitive uniqueness without needing the citext extension.
create unique index app_user_email_key on app_user(lower(email));
create trigger app_user_touch before update on app_user
  for each row execute function set_updated_at();

-- Owned by connect-pg-simple; column names and types are fixed by that library.
create table user_session (
  sid    varchar primary key,
  sess   json not null,
  expire timestamptz not null
);
create index user_session_expire_idx on user_session(expire);
