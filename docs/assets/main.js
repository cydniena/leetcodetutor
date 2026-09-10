/* Renders the page from the exported query results in window.ANALYTICS.
   Everything here is presentation -- if a number looks wrong, the query in
   server/src/repos/analytics.js is the place to look, not this file. */

import { barChart, dataTable, lineChart, proportionBar } from './charts.js';

const A = window.ANALYTICS;
const $ = (id) => document.getElementById(id);

/* Custom-property references, not resolved hex. Charts set them through the
   `style` attribute, so a viewer switching OS theme mid-visit repaints the
   marks instead of leaving them on the previous mode's steps. */
const SERIES = {
  easy: 'var(--series-1)',
  medium: 'var(--series-2)',
};
const pct = (v) => `${Math.round(v * 100)}%`;
const min = (v) => `${Math.round(v)}m`;

if (!A) {
  document.querySelector('.wrap').insertAdjacentHTML('afterbegin',
    '<p class="notice">Chart data missing — run <code>npm run export:analytics</code>.</p>');
}

/* ------------------------------------------------------------- the tiles -- */
/* Three stat tiles rather than three charts: each is a single before/after
   pair, which is a number, not a trend. The delta carries an arrow glyph and
   the word "better"/"worse" so meaning never rests on colour alone. */
function renderTiles() {
  const { baseline: b, app } = A.headline;
  if (!b || !app) return;

  const tiles = [
    {
      label: 'Average time-to-solve',
      value: min(app.avg_minutes),
      unit: 'per attempt',
      from: `${min(b.avg_minutes)} across ${b.attempts} baseline attempts`,
      change: (app.avg_minutes - b.avg_minutes) / b.avg_minutes,
      goodDirection: 'down',
    },
    {
      label: 'Solved with no hint at all',
      value: pct(app.clean_rate),
      unit: 'of attempts',
      from: `${pct(b.clean_rate)} at baseline`,
      change: app.clean_rate - b.clean_rate,
      goodDirection: 'up',
      absolute: true,
    },
    {
      label: 'Needed hint level 2 or deeper',
      value: pct(app.deep_hint_share),
      unit: 'of solves',
      from: `${pct(b.deep_hint_share)} at baseline`,
      change: app.deep_hint_share - b.deep_hint_share,
      goodDirection: 'down',
      absolute: true,
    },
  ];

  $('tiles').innerHTML = tiles.map((t) => {
    const rising = t.change > 0;
    const better = t.goodDirection === (rising ? 'up' : 'down');
    const magnitude = t.absolute
      ? `${Math.abs(Math.round(t.change * 100))} pts`
      : `${Math.abs(Math.round(t.change * 100))}%`;
    return `<div class="tile">
      <p class="label">${t.label}</p>
      <p class="figure">${t.value} <span class="unit">${t.unit}</span></p>
      <p class="delta ${better ? 'better' : 'worse'}">
        <span class="arrow" aria-hidden="true">${rising ? '↑' : '↓'}</span>
        ${magnitude} ${rising ? 'higher' : 'lower'} — ${better ? 'better' : 'worse'}
      </p>
      <p class="from">from ${t.from}</p>
    </div>`;
  }).join('');

  $('tiles-caveat').textContent =
    `Seeded demo data: ${A.totals.attempts} attempts between ${A.totals.first_attempt} `
    + `and ${A.totals.last_attempt}, of which ${A.totals.baseline_attempts} are flagged as `
    + `the hand-logged baseline. At this sample size the direction is the signal; `
    + `the exact percentages are not.`;
}

/* ------------------------------------------------- time-to-solve by week -- */
function renderTimeToSolve() {
  const byDifficulty = {};
  for (const row of A.timeToSolve) {
    (byDifficulty[row.difficulty] ??= []).push({
      x: row.week, y: Number(row.avg_minutes), n: row.solves,
    });
  }

  // Only plot a difficulty that has enough weeks to show a trend. With one
  // point there is no trend, and drawing a line through it would be a lie.
  const MIN_WEEKS = 3;
  const plotted = ['easy', 'medium'].filter((d) => (byDifficulty[d]?.length ?? 0) >= MIN_WEEKS);
  const excluded = Object.entries(byDifficulty)
    .filter(([d]) => !plotted.includes(d))
    .map(([d, pts]) => `${d} (${pts.reduce((s, p) => s + p.n, 0)} solve${
      pts.reduce((s, p) => s + p.n, 0) === 1 ? '' : 's'})`);

  const series = plotted.map((d) => ({
    key: d, label: d, color: SERIES[d], points: byDifficulty[d],
  }));

  // Legend is always present for >= 2 series, and the lines are direct-labelled
  // too, so identity is carried twice.
  $('tts-legend').innerHTML = series.map((s) =>
    `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');

  lineChart($('chart-tts'), { series, yLabel: 'Average minutes per solve', yFormat: min });

  $('tts-caveat').textContent = excluded.length
    ? `Not plotted: ${excluded.join(', ')} — too few solves to draw a trend through. `
      + `The seeded history is weighted toward mediums, which is where the signal is.`
    : '';

  dataTable($('tts-table'), {
    caption: 'Average minutes per solved attempt, by week',
    columns: ['Week', ...plotted.map((d) => `${d} (avg min)`), ...plotted.map((d) => `${d} (n)`)],
    rows: [...new Set(A.timeToSolve.map((r) => r.week))].sort().map((week) => [
      week,
      ...plotted.map((d) => byDifficulty[d]?.find((p) => p.x === week)?.y ?? '—'),
      ...plotted.map((d) => byDifficulty[d]?.find((p) => p.x === week)?.n ?? '—'),
    ]),
  });
}

/* -------------------------------------------------------- hint dependency -- */
function renderHintDependency() {
  // One series, so no legend box: the heading names it.
  lineChart($('chart-hint'), {
    series: [{
      key: 'deep', label: 'hint 2+', color: SERIES.easy,
      points: A.hintDependency.map((r) => ({
        x: r.week, y: Number(r.deep_hint_share), n: r.solves,
      })),
    }],
    yLabel: 'Share of solves needing hint level 2 or deeper',
    yMax: 1,
    yFormat: pct,
  });

  dataTable($('hint-table'), {
    caption: 'Hint dependency by week',
    columns: ['Week', 'Solves', 'Needed hint 2+', 'Share', 'Unaided share'],
    rows: A.hintDependency.map((r) => [
      r.week, r.solves, r.needed_deep_hint,
      pct(Number(r.deep_hint_share)), pct(Number(r.unaided_share)),
    ]),
  });
}

/* --------------------------------------------------------------- retention -- */
function renderRetention() {
  const SMALL = 4; // below this, a rate is noise
  const bars = A.retention.map((r) => ({
    label: r.gap_bucket,
    value: Number(r.clean_rate),
    n: r.repeat_attempts,
    note: r.repeat_attempts < SMALL ? 'too few attempts to read anything into' : null,
  }));

  barChart($('chart-retention'), {
    bars, yMax: 1, yFormat: pct, color: SERIES.easy,
  });

  const thin = bars.filter((b) => b.n < SMALL).map((b) => b.label);
  $('retention-caveat').textContent = thin.length
    ? `Sample size is printed on every bar because it has to be: ${thin.join(' and ')} `
      + `${thin.length === 1 ? 'rests' : 'rest'} on fewer than ${SMALL} repeat attempts, `
      + `so those bars carry no real information yet. The pair in the middle is the `
      + `only comparison worth making — and it points the right way: a longer gap has `
      + `not degraded the clean-solve rate.`
    : '';

  dataTable($('retention-table'), {
    caption: 'Repeat attempts, bucketed by gap since the previous attempt on the same problem',
    columns: ['Gap', 'Repeat attempts', 'Clean-solve rate', 'Avg minutes'],
    rows: A.retention.map((r) => [
      r.gap_bucket, r.repeat_attempts, pct(Number(r.clean_rate)), `${r.avg_minutes}m`,
    ]),
  });
}

/* ----------------------------------------------------------- mastery grid -- */
function renderMastery() {
  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr>
      <th scope="col">Pattern</th><th scope="col">Topic</th>
      <th scope="col">Attempts</th><th scope="col">Clean</th>
      <th scope="col">Clean rate</th><th scope="col">Avg min</th>
      <th scope="col">Last attempted</th>
    </tr></thead>`;
  const tbody = document.createElement('tbody');

  for (const row of A.mastery) {
    const tr = document.createElement('tr');
    const untouched = row.attempts === 0;
    tr.innerHTML = `
      <th scope="row">${row.pattern}</th>
      <td class="dim">${row.topic}</td>
      <td>${row.attempts}</td>
      <td>${row.clean}</td>
      <td class="rate"></td>
      <td>${row.avg_minutes ? `${row.avg_minutes}m` : '<span class="dim">—</span>'}</td>
      <td class="${untouched ? 'overdue' : 'dim'}">${
        untouched ? 'never' : row.last_attempted}</td>`;
    const rateCell = tr.querySelector('.rate');
    if (untouched) {
      rateCell.innerHTML = '<span class="dim">no data</span>';
    } else {
      rateCell.appendChild(proportionBar(row.clean, row.attempts));
      rateCell.appendChild(document.createTextNode(pct(row.clean_rate)));
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  $('mastery-table').appendChild(table);
}

/* ---------------------------------------------------------- today + plans -- */
function renderQueue() {
  // Exported by the query, not inferred from the queue's newest row -- that
  // row is only today's date if something happens to be due today.
  const today = A.today;
  $('queue').innerHTML = A.queue.length
    ? A.queue.map((item) => {
      const late = today && item.due_on < today;
      return `<li>
        <span class="kind">${item.kind === 'review' ? 'review' : 'problem'}</span>
        <span>${item.label}${item.context ? ` <span class="dim">· ${item.context}</span>` : ''}</span>
        <span class="when ${late ? 'overdue' : ''}">${late ? 'overdue · ' : ''}${item.due_on}</span>
      </li>`;
    }).join('')
    : '<li><span class="dim">Nothing due — the queue is empty.</span></li>';
}

function renderAdherence() {
  const host = $('adherence-table');
  host.classList.remove('table-scroll');
  host.classList.add('adherence');

  for (const p of A.adherence) {
    // "Resolved" = every item whose fate is decided: done or deliberately
    // skipped. Outstanding todos are not failures, so they stay out of the
    // on-time denominator instead of dragging it down.
    const resolved = p.done + p.skipped;
    const row = document.createElement('div');
    row.className = 'adherence-row';

    const head = document.createElement('p');
    head.className = 'adherence-name';
    head.innerHTML = `${p.name} <span class="dim">\u00b7 ${p.plan_status}</span>`;
    row.appendChild(head);

    const detail = document.createElement('p');
    detail.className = 'adherence-detail';
    if (resolved) {
      detail.innerHTML = `<b>${p.done_on_time} of ${resolved}</b> resolved on time`
        + (p.done_late ? ` \u00b7 ${p.done_late} late` : '')
        + (p.skipped ? ` \u00b7 ${p.skipped} skipped` : '')
        + (p.todo ? ` \u00b7 <span class="dim">${p.todo} still to do</span>` : '');
    } else {
      detail.innerHTML = `<span class="dim">Not started \u2014 ${p.todo} item${
        p.todo === 1 ? '' : 's'} to do</span>`;
    }
    row.appendChild(detail);

    if (resolved) row.appendChild(proportionBar(p.done_on_time, resolved));
    host.appendChild(row);
  }
}

/* -------------------------------------------------------------------- go -- */
if (A) {
  renderTiles();
  renderTimeToSolve();
  renderHintDependency();
  renderRetention();
  renderMastery();
  renderQueue();
  renderAdherence();
  $('generated').textContent =
    `Last regenerated ${new Date(A.generated_at).toISOString().slice(0, 10)}.`;
}
