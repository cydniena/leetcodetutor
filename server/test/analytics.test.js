// The six analytics queries. Nothing imported this module before, so all of
// it was untested; the GitHub Pages export is its only caller today and phase
// 6 is meant to build routes on top of it unchanged.
//
// Each test owns its data. Fixtures hang off one throwaway user per suite and
// reference the seeded catalogue read-only, so a run leaves the demo data
// alone and two runs cannot collide.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import {
  DIFFICULTY_ORDER, headlineComparison, hintDependencyByWeek, masteryGrid,
  planAdherence, retentionByGap, timeToSolveByWeek, todayQueue,
} from '../src/repos/analytics.js';

/** Two users: everything is asserted against `me`, `other` proves scoping. */
let me;
let other;
let problems;
let patterns;

async function makeUser(label) {
  const { rows } = await pool.query(
    `insert into app_user (email, password_hash) values ($1, 'x') returning id`,
    [`test-analytics-${label}-${process.pid}-${Date.now()}@example.test`],
  );
  return rows[0].id;
}

before(async () => {
  me = await makeUser('me');
  other = await makeUser('other');
  ({ rows: problems } = await pool.query(
    'select id, title, difficulty from problem order by id limit 4'));
  ({ rows: patterns } = await pool.query('select id, name from pattern order by id limit 3'));
});

after(async () => {
  // Cascades clear attempts, plans and reviews.
  await pool.query('delete from app_user where id = any($1)', [[me, other]]);
  await pool.end();
});

/** Insert one attempt. Outcome and hint level must satisfy the check constraint. */
async function attempt({
  userId = me, problemId = problems[0].id, on, minutes = 30,
  outcome = 'solved_clean', hint = 0, confidence = 3, baseline = false,
}) {
  const { rows } = await pool.query(
    `insert into attempt (user_id, problem_id, attempted_on, minutes_spent,
                          outcome, max_hint_level, confidence, is_baseline)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [userId, problemId, on, minutes, outcome, hint, confidence, baseline],
  );
  return rows[0].id;
}

async function tagPattern(attemptId, patternId) {
  await pool.query(
    'insert into attempt_pattern (attempt_id, pattern_id) values ($1,$2)',
    [attemptId, patternId],
  );
}

async function makePlan({ userId = me, name, status = 'active' }) {
  const { rows } = await pool.query(
    'insert into plan (user_id, name, status) values ($1,$2,$3) returning id',
    [userId, name, status],
  );
  return rows[0].id;
}

async function planItem({
  planId, problemId = problems[0].id, target = null, status = 'todo',
  completedAt = null, sort = 0,
}) {
  const { rows } = await pool.query(
    `insert into plan_item (plan_id, problem_id, target_date, status, completed_at, sort_order)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [planId, problemId, target, status, completedAt, sort],
  );
  return rows[0].id;
}

/** Clear this suite's user-owned rows between tests. */
async function reset() {
  await pool.query('delete from attempt where user_id = any($1)', [[me, other]]);
  await pool.query('delete from plan where user_id = any($1)', [[me, other]]);
  await pool.query('delete from review where user_id = any($1)', [[me, other]]);
}

describe('masteryGrid', () => {
  it('lists every pattern, including ones never attempted', async () => {
    await reset();
    const grid = await masteryGrid(pool, me);
    const { rows: [{ n }] } = await pool.query('select count(*)::int n from pattern');
    assert.equal(grid.length, n, 'a pattern with no attempts is the point of the grid');
    for (const row of grid) {
      assert.equal(row.attempts, 0);
      assert.equal(row.clean_rate, null, 'no attempts means no rate, not zero');
      assert.equal(row.last_attempted, null);
    }
  });

  it('counts outcomes per pattern and derives a clean rate', async () => {
    await reset();
    const p = patterns[0].id;
    await tagPattern(await attempt({ on: '2026-01-05', outcome: 'solved_clean' }), p);
    await tagPattern(
      await attempt({ on: '2026-01-06', outcome: 'solved_with_hint', hint: 2 }), p);
    await tagPattern(await attempt({ on: '2026-01-07', outcome: 'gave_up', hint: 3 }), p);

    const row = (await masteryGrid(pool, me)).find((r) => r.pattern_id === p);
    assert.equal(row.attempts, 3);
    assert.equal(row.clean, 1);
    assert.equal(row.hinted, 1);
    assert.equal(row.gave_up, 1);
    assert.equal(row.clean_rate, 0.333, 'rounded to three places');
    assert.equal(row.last_attempted, '2026-01-07', 'a plain date, never a Date object');
    assert.equal(row.avg_minutes, 30);
  });

  it('counts an attempt once per pattern it is tagged with', async () => {
    await reset();
    const id = await attempt({ on: '2026-02-01' });
    await tagPattern(id, patterns[0].id);
    await tagPattern(id, patterns[1].id);

    const grid = await masteryGrid(pool, me);
    for (const pid of [patterns[0].id, patterns[1].id]) {
      assert.equal(grid.find((r) => r.pattern_id === pid).attempts, 1);
    }
  });

  it('ignores another user\'s attempts on the same pattern', async () => {
    await reset();
    const p = patterns[0].id;
    await tagPattern(await attempt({ userId: other, on: '2026-01-05' }), p);

    const row = (await masteryGrid(pool, me)).find((r) => r.pattern_id === p);
    assert.equal(row.attempts, 0, 'the user filter belongs in ON, not WHERE');
    assert.equal(row.clean_rate, null);
  });
});

describe('timeToSolveByWeek', () => {
  it('averages minutes per difficulty per week and excludes give-ups', async () => {
    await reset();
    const easy = problems.find((p) => p.difficulty === 'easy');
    const medium = problems.find((p) => p.difficulty === 'medium');
    // 2026-01-05 and 2026-01-07 are the Monday and Wednesday of one ISO week.
    await attempt({ problemId: easy.id, on: '2026-01-05', minutes: 10 });
    await attempt({ problemId: easy.id, on: '2026-01-07', minutes: 20 });
    await attempt({ problemId: medium.id, on: '2026-01-05', minutes: 60 });
    await attempt({
      problemId: easy.id, on: '2026-01-06', minutes: 600, outcome: 'gave_up', hint: 3 });

    const rows = await timeToSolveByWeek(pool, me);
    const week = rows.filter((r) => r.week === '2026-01-05');
    assert.equal(week.length, 2, 'one row per difficulty present');
    const byDiff = Object.fromEntries(week.map((r) => [r.difficulty, r]));
    assert.equal(byDiff.easy.solves, 2);
    assert.equal(byDiff.easy.avg_minutes, 15, 'the 600-minute give-up must not count');
    assert.equal(byDiff.medium.avg_minutes, 60);
  });

  it('groups by ISO week, so Sunday belongs to the week before', async () => {
    await reset();
    // 2026-01-11 is a Sunday; its ISO week starts Monday 2026-01-05.
    await attempt({ on: '2026-01-11', minutes: 40 });
    await attempt({ on: '2026-01-12', minutes: 50 }); // the next Monday
    const weeks = (await timeToSolveByWeek(pool, me)).map((r) => r.week);
    assert.deepEqual(weeks, ['2026-01-05', '2026-01-12']);
  });

  it('returns nothing for a user with no attempts', async () => {
    await reset();
    assert.deepEqual(await timeToSolveByWeek(pool, me), []);
  });
});

describe('hintDependencyByWeek', () => {
  it('reports the deep-hint and unaided shares of solves', async () => {
    await reset();
    await attempt({ on: '2026-01-05', outcome: 'solved_clean' });
    await attempt({ on: '2026-01-06', outcome: 'solved_with_hint', hint: 1 });
    await attempt({ on: '2026-01-07', outcome: 'solved_with_hint', hint: 2 });
    await attempt({ on: '2026-01-08', outcome: 'solved_with_hint', hint: 3 });
    // Excluded: a give-up is not a solve, so it must not dilute either share.
    await attempt({ on: '2026-01-09', outcome: 'gave_up', hint: 3 });

    const [row] = await hintDependencyByWeek(pool, me);
    assert.equal(row.week, '2026-01-05');
    assert.equal(row.solves, 4);
    assert.equal(row.needed_deep_hint, 2, 'levels 2 and 3');
    assert.equal(row.deep_hint_share, 0.5);
    assert.equal(row.unaided_share, 0.25, 'only the clean solve used no hint');
  });

  it('returns no rows when every attempt was a give-up', async () => {
    await reset();
    await attempt({ on: '2026-01-05', outcome: 'gave_up', hint: 0 });
    // Not a zero row: dividing by zero solves has no answer to report.
    assert.deepEqual(await hintDependencyByWeek(pool, me), []);
  });
});

describe('retentionByGap', () => {
  it('buckets repeat attempts by the gap since the previous one', async () => {
    await reset();
    const [a, b, c] = problems;
    // First attempt on each problem is not a repeat; the second is.
    await attempt({ problemId: a.id, on: '2026-01-01' });
    await attempt({ problemId: a.id, on: '2026-01-04' });   // 3 days
    await attempt({ problemId: b.id, on: '2026-01-01' });
    await attempt({ problemId: b.id, on: '2026-01-15' });   // 14 days
    await attempt({ problemId: c.id, on: '2026-01-01' });
    await attempt({ problemId: c.id, on: '2026-04-01' });   // 90 days

    const byBucket = Object.fromEntries(
      (await retentionByGap(pool, me)).map((r) => [r.gap_bucket, r]));
    assert.deepEqual(Object.keys(byBucket), ['1-6 days', '7-20 days', '60+ days']);
    assert.equal(byBucket['1-6 days'].min_gap_days, 3);
    assert.equal(byBucket['7-20 days'].repeat_attempts, 1);
    assert.equal(byBucket['7-20 days'].min_gap_days, 14);
    assert.equal(byBucket['60+ days'].min_gap_days, 90);
    assert.equal(byBucket['1-6 days'].clean_rate, 1);
    assert.equal(byBucket['1-6 days'].avg_minutes, 30);
  });

  it('excludes the first attempt on a problem', async () => {
    await reset();
    await attempt({ problemId: problems[0].id, on: '2026-01-01' });
    assert.deepEqual(await retentionByGap(pool, me), [], 'nothing to compare against yet');
  });

  it('orders buckets by increasing gap', async () => {
    await reset();
    const [a, b] = problems;
    await attempt({ problemId: a.id, on: '2026-01-01' });
    await attempt({ problemId: a.id, on: '2026-03-01' }); // 59 days
    await attempt({ problemId: b.id, on: '2026-01-01' });
    await attempt({ problemId: b.id, on: '2026-01-03' }); // 2 days
    const gaps = (await retentionByGap(pool, me)).map((r) => r.min_gap_days);
    assert.deepEqual(gaps, [...gaps].sort((x, y) => x - y));
  });

  it('keeps each problem\'s history separate', async () => {
    await reset();
    const [a, b] = problems;
    // Interleaved dates: partitioning by problem must not pair a with b.
    await attempt({ problemId: a.id, on: '2026-01-01' });
    await attempt({ problemId: b.id, on: '2026-01-02' });
    await attempt({ problemId: a.id, on: '2026-01-03' });
    const rows = await retentionByGap(pool, me);
    assert.equal(rows.length, 1, 'only problem a has a repeat');
    assert.equal(rows[0].min_gap_days, 2, 'a to a, not a to b');
  });

  it('scopes to one user', async () => {
    await reset();
    await attempt({ userId: other, problemId: problems[0].id, on: '2026-01-01' });
    await attempt({ userId: other, problemId: problems[0].id, on: '2026-01-05' });
    assert.deepEqual(await retentionByGap(pool, me), []);
  });
});

describe('planAdherence', () => {
  it('reports zero items for a plan with none', async () => {
    await reset();
    // Regression: count(*) over a LEFT JOIN counts the one all-null row a
    // plan with no items produces, so an empty plan reported items: 1 while
    // done + skipped + todo were all 0 -- a total that could not be right.
    const planId = await makePlan({ name: 'Empty', status: 'draft' });
    const [row] = await planAdherence(pool, me);
    assert.equal(row.plan_id, planId);
    assert.equal(row.items, 0);
    assert.equal(row.done + row.skipped + row.todo, row.items, 'the buckets must total items');
  });

  it('splits done into on-time and late against the target date', async () => {
    await reset();
    const planId = await makePlan({ name: 'Week 1' });
    await planItem({
      planId, target: '2026-01-10', status: 'done', completedAt: '2026-01-09T12:00:00Z', sort: 1 });
    await planItem({
      planId, target: '2026-01-10', status: 'done', completedAt: '2026-01-10T23:00:00Z', sort: 2 });
    await planItem({
      planId, target: '2026-01-10', status: 'done', completedAt: '2026-01-12T01:00:00Z', sort: 3 });
    await planItem({ planId, target: '2026-01-10', status: 'skipped', sort: 4 });
    await planItem({ planId, target: '2026-01-10', status: 'todo', sort: 5 });

    const [row] = await planAdherence(pool, me);
    assert.equal(row.items, 5);
    assert.equal(row.done, 3);
    assert.equal(row.done_on_time, 2, 'completing on the target date is on time');
    assert.equal(row.done_late, 1);
    assert.equal(row.skipped, 1);
    assert.equal(row.todo, 1);
    assert.equal(row.done_on_time + row.done_late, row.done);
  });

  it('counts an item done with no target date as neither on time nor late', async () => {
    await reset();
    const planId = await makePlan({ name: 'Undated' });
    await planItem({ planId, target: null, status: 'done', completedAt: '2026-01-09T12:00:00Z' });
    const [row] = await planAdherence(pool, me);
    assert.equal(row.items, 1);
    assert.equal(row.done, 1);
    assert.equal(row.done_on_time, 0, 'nothing to be late against');
    assert.equal(row.done_late, 0);
  });

  it('covers every plan status and excludes other users', async () => {
    await reset();
    await makePlan({ name: 'A active', status: 'active' });
    await makePlan({ name: 'B archived', status: 'archived' });
    await makePlan({ name: 'C draft', status: 'draft' });
    await makePlan({ userId: other, name: 'Not mine', status: 'active' });

    const rows = await planAdherence(pool, me);
    assert.deepEqual(rows.map((r) => r.plan_status), ['active', 'archived', 'draft']);
    assert.ok(!rows.some((r) => r.name === 'Not mine'));
  });
});

describe('todayQueue', () => {
  it('returns due and overdue plan items with due reviews', async () => {
    await reset();
    const planId = await makePlan({ name: 'Active plan' });
    await planItem({ planId, target: '2026-01-01', sort: 1 });          // overdue
    await planItem({ planId, target: '2026-01-10', sort: 2 });          // due today
    await planItem({ planId, target: '2026-01-11', sort: 3 });          // not yet
    await pool.query(
      `insert into review (user_id, pattern_id, interval_days, due_on) values ($1,$2,1,$3)`,
      [me, patterns[0].id, '2026-01-08']);

    const rows = await todayQueue(pool, me, '2026-01-10');
    assert.equal(rows.length, 3, 'two plan items plus one review');
    assert.deepEqual(rows.map((r) => r.due_on), ['2026-01-01', '2026-01-08', '2026-01-10'],
      'ordered by due date, oldest first');
    assert.deepEqual([...new Set(rows.map((r) => r.kind))].sort(), ['plan_item', 'review']);
    const review = rows.find((r) => r.kind === 'review');
    assert.equal(review.label, patterns[0].name);
    assert.equal(review.difficulty, null, 'a review is not a problem');
  });

  it('never asks the database what day it is', async () => {
    await reset();
    const planId = await makePlan({ name: 'Dated plan' });
    await planItem({ planId, target: '2999-12-31' });
    // The caller decides "today", so a far-future date is reachable.
    assert.equal((await todayQueue(pool, me, '2026-01-10')).length, 0);
    assert.equal((await todayQueue(pool, me, '2999-12-31')).length, 1);
  });

  it('ignores items on plans that are not active', async () => {
    await reset();
    for (const status of ['draft', 'archived']) {
      const planId = await makePlan({ name: `Plan ${status}`, status });
      await planItem({ planId, target: '2026-01-01' });
    }
    assert.deepEqual(await todayQueue(pool, me, '2026-01-10'), []);
  });

  it('ignores items that are already done or skipped, and undated ones', async () => {
    await reset();
    const planId = await makePlan({ name: 'Mixed' });
    await planItem({
      planId, target: '2026-01-01', status: 'done', completedAt: '2026-01-01T09:00:00Z', sort: 1 });
    await planItem({ planId, target: '2026-01-01', status: 'skipped', sort: 2 });
    await planItem({ planId, target: null, status: 'todo', sort: 3 });
    assert.deepEqual(await todayQueue(pool, me, '2026-01-10'), []);
  });

  it('scopes both halves of the union to the user', async () => {
    await reset();
    const planId = await makePlan({ userId: other, name: 'Other plan' });
    await planItem({ planId, target: '2026-01-01' });
    await pool.query(
      `insert into review (user_id, pattern_id, interval_days, due_on) values ($1,$2,1,$3)`,
      [other, patterns[0].id, '2026-01-01']);
    assert.deepEqual(await todayQueue(pool, me, '2026-01-10'), []);
  });
});

describe('headlineComparison', () => {
  it('splits baseline from app-era attempts', async () => {
    await reset();
    await attempt({ on: '2026-01-01', minutes: 60, outcome: 'gave_up', hint: 0, baseline: true });
    await attempt({ on: '2026-01-02', minutes: 40, outcome: 'solved_with_hint', hint: 2, baseline: true });
    await attempt({ on: '2026-02-01', minutes: 20, outcome: 'solved_clean', baseline: false });
    await attempt({ on: '2026-02-02', minutes: 30, outcome: 'solved_with_hint', hint: 1, baseline: false });

    const out = await headlineComparison(pool, me);
    assert.deepEqual(Object.keys(out).sort(), ['app', 'baseline']);
    assert.equal(out.baseline.attempts, 2);
    assert.equal(out.baseline.avg_minutes, 50);
    assert.equal(out.baseline.clean_rate, 0);
    // One deep hint over one non-give-up attempt.
    assert.equal(out.baseline.deep_hint_share, 1);

    assert.equal(out.app.attempts, 2);
    assert.equal(out.app.avg_minutes, 25);
    assert.equal(out.app.clean_rate, 0.5);
    assert.equal(out.app.deep_hint_share, 0, 'a level-1 hint is not a deep hint');
  });

  it('reports no deep-hint share when every attempt was a give-up', async () => {
    await reset();
    await attempt({ on: '2026-01-01', outcome: 'gave_up', hint: 3, baseline: true });
    const out = await headlineComparison(pool, me);
    // nullif keeps this null instead of dividing by zero.
    assert.equal(out.baseline.deep_hint_share, null);
    assert.equal(out.baseline.clean_rate, 0);
  });

  it('returns an empty object for a user with no attempts', async () => {
    await reset();
    assert.deepEqual(await headlineComparison(pool, me), {},
      'callers must handle a missing era rather than a zero row');
  });
});

describe('DIFFICULTY_ORDER', () => {
  it('lists every difficulty the schema allows, easiest first', async () => {
    const { rows } = await pool.query(
      `select distinct difficulty from problem order by difficulty`);
    assert.deepEqual(
      [...DIFFICULTY_ORDER].sort(), rows.map((r) => r.difficulty).sort(),
      'a difficulty missing here would drop out of every chart');
    assert.deepEqual(DIFFICULTY_ORDER, ['easy', 'medium', 'hard']);
  });
});
