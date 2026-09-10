// Seeds the catalog, two users, and a synthetic history for the demo learner.
//
// The history is deliberately shaped: 12 weeks long, with the first 3 weeks
// flagged is_baseline (the attempts logged by hand before the app existed) and
// a real improving trend afterwards -- falling time-to-solve, falling hint
// dependency, and repeat attempts at varied gaps. That way the analytics pages
// have something with a shape to check against instead of a flat line.
//
// Deterministic: a fixed-seed LCG, so `npm run db:reset` reproduces the same
// numbers and a change in a chart is a change in the code, not the dice.

import bcrypt from 'bcryptjs';
import { pool, tx } from '../src/db.js';
import { addDays, todayIn } from '../src/lib/dates.js';
import { PATTERNS, PROBLEMS, TOPICS, problemUrl } from './seed-data.js';

const DEMO_TZ = 'America/New_York';
const TODAY = todayIn(DEMO_TZ);
const WEEKS = 12;
const BASELINE_WEEKS = 3;

// --- deterministic pseudo-randomness -------------------------------------
let rngState = 20260910;
const rand = () => ((rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

// --- the improvement model ------------------------------------------------
const BASE_MINUTES = { easy: 26, medium: 58, hard: 95 };

/** Time-to-solve falls ~3.5% of the starting figure per week. */
function minutesFor(difficulty, week) {
  const base = BASE_MINUTES[difficulty];
  const trend = base * (1 - 0.035 * week);
  const jitter = 1 + (rand() - 0.5) * 0.3;
  return Math.max(5, Math.min(600, Math.round(trend * jitter)));
}

/** Clean-solve rate climbs from 0.22 to about 0.68 over the 12 weeks. */
const cleanRate = (week) => 0.22 + 0.042 * week;

/** Early on, when a hint is needed it tends to be a deep one. */
function hintLevelFor(week) {
  const deep = 0.7 - 0.045 * week; // share of hinted solves needing level 2+
  if (chance(deep)) return chance(0.4) ? 3 : 2;
  return 1;
}

function outcomeFor(difficulty, week) {
  const penalty = difficulty === 'hard' ? 0.22 : difficulty === 'medium' ? 0.08 : 0;
  if (chance(0.09 - 0.005 * week + penalty * 0.3)) {
    return { outcome: 'gave_up', max_hint_level: chance(0.6) ? 3 : randInt(0, 2) };
  }
  if (chance(Math.max(0.05, cleanRate(week) - penalty))) {
    return { outcome: 'solved_clean', max_hint_level: 0 };
  }
  return { outcome: 'solved_with_hint', max_hint_level: hintLevelFor(week) };
}

function confidenceFor(outcome, week) {
  if (outcome === 'gave_up') return randInt(1, 2);
  if (outcome === 'solved_with_hint') return Math.min(5, randInt(2, 3) + (week > 7 ? 1 : 0));
  return Math.min(5, randInt(3, 4) + (week > 5 ? 1 : 0));
}

const REFLECTIONS = {
  solved_clean: [
    'Recognised the pattern in under a minute this time.',
    'Wrote the invariant down before coding. Made the loop obvious.',
    'Clean first pass. Off-by-one on the boundary, caught it by hand-tracing.',
    'Second time seeing this shape and it came straight back.',
  ],
  solved_with_hint: [
    'Knew it was a window but could not name the state to keep.',
    'Had the right idea, wrong data structure. Needed the nudge on the key.',
    'Stalled on the second phase. Hint 2 unblocked it immediately.',
    'Got there but slowly -- kept trying to brute force the check first.',
  ],
  gave_up: [
    'Could not see why the predicate is monotonic. Coming back to this.',
    'Confused myself with indices and never recovered. Reset needed.',
    'No idea this was even the right family of problem. Read the explainer after.',
  ],
};

async function main() {
  const passwordHash = await bcrypt.hash('password123', 12);

  await tx(async (db) => {
    console.log('clearing existing data...');
    await db.query(`
      truncate attempt_pattern, attempt, plan_item, plan, goal_topic, goal, note, review,
               problem_pattern, problem, pattern_hint, pattern, topic_prereq, topic,
               app_user, user_session
      restart identity cascade`);

    // ---- reference data ---------------------------------------------------
    const topicId = {};
    for (const [i, t] of TOPICS.entries()) {
      const { rows } = await db.query(
        `insert into topic (slug, name, blurb, sort_order) values ($1,$2,$3,$4) returning id`,
        [t.slug, t.name, t.blurb, i],
      );
      topicId[t.slug] = rows[0].id;
    }
    for (const t of TOPICS) {
      for (const prereq of t.prereqs) {
        await db.query(
          `insert into topic_prereq (topic_id, prereq_topic_id) values ($1,$2)`,
          [topicId[t.slug], topicId[prereq]],
        );
      }
    }
    console.log(`  ${TOPICS.length} topics`);

    const patternId = {};
    for (const [i, p] of PATTERNS.entries()) {
      const { rows } = await db.query(
        `insert into pattern (topic_id, slug, name, explainer, sort_order)
         values ($1,$2,$3,$4,$5) returning id`,
        [topicId[p.topic], p.slug, p.name, p.explainer, i],
      );
      patternId[p.slug] = rows[0].id;
      for (const [j, body] of p.hints.entries()) {
        await db.query(
          `insert into pattern_hint (pattern_id, level, body) values ($1,$2,$3)`,
          [rows[0].id, j + 1, body],
        );
      }
    }
    console.log(`  ${PATTERNS.length} patterns with hint ladders`);

    const problems = [];
    for (const [slug, title, difficulty, topic, patterns] of PROBLEMS) {
      const { rows } = await db.query(
        `insert into problem (slug, title, difficulty, url, topic_id)
         values ($1,$2,$3,$4,$5) returning id`,
        [slug, title, difficulty, problemUrl(slug), topicId[topic]],
      );
      const id = rows[0].id;
      for (const [j, patternSlug] of patterns.entries()) {
        await db.query(
          `insert into problem_pattern (problem_id, pattern_id, is_primary) values ($1,$2,$3)`,
          [id, patternId[patternSlug], j === 0],
        );
      }
      problems.push({ id, slug, title, difficulty, patterns: patterns.map((s) => patternId[s]) });
    }
    console.log(`  ${problems.length} problems`);

    // ---- users ------------------------------------------------------------
    const { rows: userRows } = await db.query(
      `insert into app_user (email, password_hash, role, timezone) values
         ('learner@example.com', $1, 'learner', $2),
         ('admin@example.com',   $1, 'admin',   $2)
       returning id, email, role`,
      [passwordHash, DEMO_TZ],
    );
    const learner = userRows.find((u) => u.role === 'learner');
    console.log('  2 users (learner@example.com / admin@example.com, password123)');

    // ---- goal -------------------------------------------------------------
    const { rows: goalRows } = await db.query(
      `insert into goal (user_id, target_date, hours_per_week, is_active)
       values ($1,$2,$3,true) returning id`,
      [learner.id, addDays(TODAY, 45), 10],
    );
    for (const slug of ['sliding-window', 'graphs', 'dynamic-programming']) {
      await db.query(`insert into goal_topic (goal_id, topic_id) values ($1,$2)`,
        [goalRows[0].id, topicId[slug]]);
    }

    // ---- plans ------------------------------------------------------------
    const { rows: planRows } = await db.query(
      `insert into plan (user_id, name, status) values
         ($1, '12-week interview prep', 'active'),
         ($1, 'Graph drilling (draft)',  'draft'),
         ($1, 'Warm-up week (archived)', 'archived')
       returning id, name, status`,
      [learner.id],
    );
    const activePlan = planRows.find((p) => p.status === 'active');
    const draftPlan = planRows.find((p) => p.status === 'draft');
    const archivedPlan = planRows.find((p) => p.status === 'archived');

    // 24 items on the active plan: some done on time, some done late, some
    // skipped, a few overdue todo (so the dashboard queue is not empty) and
    // the rest scheduled ahead.
    const planItems = [];
    const planned = problems.filter((_, i) => i % 2 === 0).slice(0, 24);
    for (const [i, problem] of planned.entries()) {
      const targetDate = addDays(TODAY, -18 + i * 2); // -18 .. +28
      const isPast = targetDate < TODAY;
      let status = 'todo';
      if (isPast) status = chance(0.75) ? 'done' : 'skipped';
      const completedAt =
        status === 'done'
          ? `${addDays(targetDate, chance(0.7) ? 0 : randInt(1, 5))}T18:30:00Z`
          : null;
      const { rows } = await db.query(
        `insert into plan_item (plan_id, problem_id, target_date, sort_order, status, completed_at)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [activePlan.id, problem.id, targetDate, (i + 1) * 10, status, completedAt],
      );
      planItems.push({ id: rows[0].id, problemId: problem.id, status, targetDate });
    }

    for (const [i, problem] of problems.filter((p) => p.slug.includes('matrix') || p.slug.includes('island') || p.slug.includes('ladder') || p.slug.includes('course') || p.slug.includes('clone') || p.slug.includes('orange')).entries()) {
      await db.query(
        `insert into plan_item (plan_id, problem_id, target_date, sort_order, status)
         values ($1,$2,null,$3,'todo')`,
        [draftPlan.id, problem.id, (i + 1) * 10],
      );
    }
    for (const [i, problem] of problems.filter((p) => p.difficulty === 'easy').slice(0, 5).entries()) {
      await db.query(
        `insert into plan_item (plan_id, problem_id, target_date, sort_order, status, completed_at)
         values ($1,$2,$3,$4,'done',$5)`,
        [archivedPlan.id, problem.id, addDays(TODAY, -80 + i), (i + 1) * 10,
          `${addDays(TODAY, -80 + i)}T20:00:00Z`],
      );
    }
    console.log(`  3 plans, ${planItems.length + 11} plan items`);

    // ---- attempts ---------------------------------------------------------
    // One or two attempts per week, weighted toward problems on the plan, plus
    // a set of deliberate repeats so the retention query has real gaps.
    const attempts = [];
    const attemptedProblems = [];

    for (let week = 0; week < WEEKS; week++) {
      const perWeek = week < BASELINE_WEEKS ? 5 : randInt(2, 4);
      for (let n = 0; n < perWeek; n++) {
        const dayOffset = -(WEEKS - 1 - week) * 7 + randInt(0, 6);
        const attemptedOn = addDays(TODAY, Math.min(dayOffset, 0));

        // 30% of attempts after week 4 are a repeat of something older, which
        // is what the retention metric measures.
        const repeat = week >= 4 && attemptedProblems.length > 6 && chance(0.3);
        const problem = repeat ? pick(attemptedProblems) : pick(problems);

        const { outcome, max_hint_level } = outcomeFor(problem.difficulty, week);
        const planItem = planItems.find((pi) => pi.problemId === problem.id && pi.status === 'done');

        attempts.push({
          problem,
          plan_item_id: planItem ? planItem.id : null,
          attempted_on: attemptedOn,
          minutes_spent: minutesFor(problem.difficulty, repeat ? Math.min(11, week + 3) : week),
          outcome,
          max_hint_level,
          confidence: confidenceFor(outcome, week),
          reflection: chance(0.75) ? pick(REFLECTIONS[outcome]) : null,
          is_baseline: week < BASELINE_WEEKS,
        });

        if (!repeat) attemptedProblems.push(problem);
      }
    }

    for (const a of attempts) {
      const { rows } = await db.query(
        `insert into attempt (user_id, problem_id, plan_item_id, attempted_on, minutes_spent,
                              outcome, max_hint_level, confidence, reflection, is_baseline)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [learner.id, a.problem.id, a.plan_item_id, a.attempted_on, a.minutes_spent,
          a.outcome, a.max_hint_level, a.confidence, a.reflection, a.is_baseline],
      );
      // Tag the primary pattern always; sometimes a secondary one too, so the
      // multi-pattern case is exercised from day one.
      const tags = [a.problem.patterns[0]];
      if (a.problem.patterns.length > 1 && chance(0.5)) tags.push(a.problem.patterns[1]);
      for (const patternIdValue of tags) {
        await db.query(
          `insert into attempt_pattern (attempt_id, pattern_id) values ($1,$2)`,
          [rows[0].id, patternIdValue],
        );
      }
    }
    console.log(`  ${attempts.length} attempts (${attempts.filter((a) => a.is_baseline).length} baseline)`);

    // ---- reviews (1 / 3 / 7 / 21 ladder) ----------------------------------
    const LADDER = [1, 3, 7, 21];
    let dueOffset = -4;
    for (const p of PATTERNS) {
      const interval = LADDER[randInt(0, 3)];
      await db.query(
        `insert into review (user_id, pattern_id, interval_days, due_on, last_reviewed_on, last_result)
         values ($1,$2,$3,$4,$5,$6)`,
        [learner.id, patternId[p.slug], interval, addDays(TODAY, dueOffset),
          addDays(TODAY, dueOffset - interval), chance(0.7) ? 'pass' : 'fail'],
      );
      dueOffset += 2; // -4, -2, 0, 2, ... so some are overdue, one is due today
    }
    console.log(`  ${PATTERNS.length} review schedules`);

    // ---- notes ------------------------------------------------------------
    const noteRows = [
      ['pattern', 'variable-sliding-window', 'My recurring mistake: I shrink with an if instead of a while. Two invalid elements in a row and the window is wrong. WHILE.'],
      ['pattern', 'binary-search-on-answer', 'Checklist before coding: (1) write feasible(X), (2) prove feasible is monotonic, (3) set lo/hi to the real answer bounds, not array indices.'],
      ['pattern', 'monotonic-stack', 'Store INDICES, not values. Every area problem needs the index to compute the width.'],
      ['pattern', 'fast-and-slow-pointers', 'Phase 2 is the bit I forget: reset one pointer to head, then step both by one. That is the cycle entrance.'],
      ['problem', 'trapping-rain-water', 'Solved with the stack, but the two-pointer version is shorter and I could not derive it. Come back to this.'],
      ['problem', 'minimum-window-substring', 'Needed hint 3. The "formed" counter that tracks how many chars hit their required count is the piece I never invent on my own.'],
      ['problem', 'course-schedule', 'Kahn topological sort via BFS on in-degrees. Cycle exists iff fewer than n nodes get processed.'],
      ['problem', 'validate-binary-search-tree', 'Range-passing beats in-order for me. Passing (low, high) down is harder to get wrong than remembering the previous value.'],
    ];
    for (const [kind, slug, body] of noteRows) {
      if (kind === 'pattern') {
        await db.query(`insert into note (user_id, pattern_id, body) values ($1,$2,$3)`,
          [learner.id, patternId[slug], body]);
      } else {
        await db.query(`insert into note (user_id, problem_id, body) values ($1,$2,$3)`,
          [learner.id, problems.find((p) => p.slug === slug).id, body]);
      }
    }
    console.log(`  ${noteRows.length} notes`);
  });

  console.log('\nSeed complete.');
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
