-- Rate limiting state for the credential endpoints.
--
-- In Postgres rather than a process-local map or Redis, for the same reason
-- sessions live here: limits that reset when the process restarts are not
-- limits, and an attacker who can trigger a restart can clear them. Keeping it
-- here also means the counters stay correct if this ever runs as more than one
-- instance. The in-process burst gate in middleware/rate-limit.js sits in front
-- of this table and is explicitly best-effort -- it sheds floods, it does not
-- enforce the policy.
create table auth_attempt (
  -- 'ip' counts every credential request from an address; 'email' counts
  -- consecutive failed logins for one submitted address.
  scope             text not null check (scope in ('ip', 'email')),
  subject           text not null,
  attempts          integer not null default 0,
  -- Start of the current counting window. Rolled forward, rather than the row
  -- being deleted, so one row per subject is all this table ever holds.
  window_started_at timestamptz not null default now(),
  last_at           timestamptz not null default now(),
  primary key (scope, subject)
);

-- For the periodic sweep of rows nobody is counting any more.
create index auth_attempt_last_at_idx on auth_attempt(last_at);
