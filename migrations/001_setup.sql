-- Shared trigger function: keeps updated_at honest without the app having to remember.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
