// The six analytics queries, in one place.
//
// Written now rather than in phase 6 because the GitHub Pages export needs
// them, and having the SQL in two places would guarantee the page and the app
// eventually disagree. Phase 6 adds routes and charts on top of these; it does
// not rewrite the queries.
//
// Every function takes userId and puts it in the WHERE clause, same rule as
// every other repo here. There is no unscoped variant.

/** 1. Mastery grid: per pattern, attempts, clean-solve rate, last attempted. */
export async function masteryGrid(db, userId) {
  const { rows } = await db.query(
    `select p.id            as pattern_id,
            p.slug          as pattern_slug,
            p.name          as pattern,
            t.name          as topic,
            count(a.id)     as attempts,
            count(*) filter (where a.outcome = 'solved_clean')  as clean,
            count(*) filter (where a.outcome = 'solved_with_hint') as hinted,
            count(*) filter (where a.outcome = 'gave_up')       as gave_up,
            max(a.attempted_on) as last_attempted,
            round(avg(a.minutes_spent)::numeric, 1) as avg_minutes
       from pattern p
       join topic t on t.id = p.topic_id
       -- LEFT JOIN, with the user filter in ON rather than WHERE, so that a
       -- pattern with zero attempts still appears. Those rows are the
       -- untouched weak spots, which is the whole point of the grid.
       left join attempt_pattern ap on ap.pattern_id = p.id
       left join attempt a on a.id = ap.attempt_id and a.user_id = $1
      group by p.id, p.slug, p.name, t.name, t.sort_order, p.sort_order
      order by t.sort_order, p.sort_order`,
    [userId],
  );
  return rows.map((r) => ({
    ...r,
    clean_rate: r.attempts ? Number((r.clean / r.attempts).toFixed(3)) : null,
  }));
}

/** 2. Average time-to-solve per difficulty, by week. Excludes give-ups. */
export async function timeToSolveByWeek(db, userId) {
  const { rows } = await db.query(
    `select date_trunc('week', a.attempted_on)::date as week,
            p.difficulty,
            round(avg(a.minutes_spent)::numeric, 1) as avg_minutes,
            count(*) as solves
       from attempt a
       join problem p on p.id = a.problem_id
      where a.user_id = $1 and a.outcome <> 'gave_up'
      group by 1, 2
      order by 1, 2`,
    [userId],
  );
  return rows;
}

/** 3. Hint dependency: share of solves needing hint level 2+, by week. */
export async function hintDependencyByWeek(db, userId) {
  const { rows } = await db.query(
    `select date_trunc('week', attempted_on)::date as week,
            count(*) as solves,
            count(*) filter (where max_hint_level >= 2) as needed_deep_hint,
            round(count(*) filter (where max_hint_level >= 2)::numeric
                  / count(*), 3) as deep_hint_share,
            round(count(*) filter (where max_hint_level = 0)::numeric
                  / count(*), 3) as unaided_share
       from attempt
      where user_id = $1 and outcome <> 'gave_up'
      group by 1
      order by 1`,
    [userId],
  );
  return rows;
}

/**
 * 4. Retention: outcomes on repeat attempts, bucketed by the gap since the
 * previous attempt on the same problem. The gap and the previous outcome both
 * come from a window function -- no extra column is needed on `attempt`.
 */
export async function retentionByGap(db, userId) {
  const { rows } = await db.query(
    `with seq as (
       select a.*,
              lag(a.attempted_on) over w as prev_on,
              lag(a.outcome)      over w as prev_outcome
         from attempt a
        where a.user_id = $1
       window w as (partition by a.user_id, a.problem_id order by a.attempted_on)
     )
     select case width_bucket(attempted_on - prev_on, array[7, 21, 60])
              when 0 then '1-6 days'
              when 1 then '7-20 days'
              when 2 then '21-59 days'
              else        '60+ days'
            end as gap_bucket,
            min(attempted_on - prev_on) as min_gap_days,
            count(*) as repeat_attempts,
            round(count(*) filter (where outcome = 'solved_clean')::numeric
                  / count(*), 3) as clean_rate,
            round(avg(minutes_spent)::numeric, 1) as avg_minutes
       from seq
      where prev_on is not null
      group by 1
      order by min(attempted_on - prev_on)`,
    [userId],
  );
  return rows;
}

/** 5. Plan adherence: completed on time vs late vs skipped vs outstanding. */
export async function planAdherence(db, userId) {
  const { rows } = await db.query(
    `select pl.id as plan_id, pl.name, pl.status as plan_status,
            count(*) as items,
            count(*) filter (where pi.status = 'done') as done,
            count(*) filter (
              where pi.status = 'done'
                and pi.target_date is not null
                and pi.completed_at::date <= pi.target_date) as done_on_time,
            count(*) filter (
              where pi.status = 'done'
                and pi.target_date is not null
                and pi.completed_at::date > pi.target_date) as done_late,
            count(*) filter (where pi.status = 'skipped') as skipped,
            count(*) filter (where pi.status = 'todo')    as todo
       from plan pl
       left join plan_item pi on pi.plan_id = pl.id
      where pl.user_id = $1
      group by pl.id, pl.name, pl.status
      order by pl.status, pl.name`,
    [userId],
  );
  return rows;
}

/**
 * 6. What to do today: overdue or due plan items on active plans, plus reviews
 * that have come due. `today` must be supplied by the caller from
 * lib/dates.js -- this query never asks the database what day it is, because
 * the database does not know the user's timezone.
 */
export async function todayQueue(db, userId, today) {
  const { rows } = await db.query(
    `select 'plan_item' as kind,
            pi.id       as id,
            pr.title    as label,
            pr.difficulty,
            pi.target_date::text as due_on,
            pl.name     as context
       from plan_item pi
       join plan pl    on pl.id = pi.plan_id
       join problem pr on pr.id = pi.problem_id
      where pl.user_id = $1
        and pl.status = 'active'
        and pi.status = 'todo'
        and pi.target_date <= $2
     union all
     select 'review', r.id, p.name, null, r.due_on::text, t.name
       from review r
       join pattern p on p.id = r.pattern_id
       join topic t   on t.id = p.topic_id
      where r.user_id = $1
        and r.due_on <= $2
      order by due_on, kind`,
    [userId, today],
  );
  return rows;
}

/**
 * The headline comparison the project is judged on: hand-logged baseline
 * attempts versus everything logged since. If these three numbers do not move,
 * the app failed.
 */
export async function headlineComparison(db, userId) {
  const { rows } = await db.query(
    `select case when is_baseline then 'baseline' else 'app' end as era,
            count(*) as attempts,
            round(avg(minutes_spent)::numeric, 1) as avg_minutes,
            round(count(*) filter (where outcome = 'solved_clean')::numeric
                  / count(*), 3) as clean_rate,
            round(count(*) filter (where max_hint_level >= 2)::numeric
                  / nullif(count(*) filter (where outcome <> 'gave_up'), 0), 3)
              as deep_hint_share
       from attempt
      where user_id = $1
      group by 1`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.era, r]));
}

/** Difficulty ordering for charts and tables. Postgres has no natural order here. */
export const DIFFICULTY_ORDER = ['easy', 'medium', 'hard'];
