/* Hand-rolled SVG charts. No chart library: this page ships three chart forms
   and a proportion bar, which is less code than a dependency and keeps the
   page a single static file with no build step.

   Conventions taken from the project's dataviz rules:
   - 2px lines, >=8px hover markers, 4px rounded bar ends anchored to baseline
   - recessive grid and axes, tabular figures on ticks
   - a legend whenever there are >=2 series; none for a single series
   - selective direct labels (line ends only, never a number on every point)
   - every chart has a "Show the numbers" table view underneath
   - crosshair + tooltip on line charts, per-bar tooltip on bar charts       */

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const VB = { w: 760, h: 300 };
const PAD = { top: 18, right: 76, bottom: 34, left: 46 };
const plot = {
  w: VB.w - PAD.left - PAD.right,
  h: VB.h - PAD.top - PAD.bottom,
};

const shortDate = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
};

/* Pick an axis top that divides evenly by the tick count, so ticks land on
   round numbers. Snapping only the top (0/18/35/53/70) is what produces the
   unreadable axis this replaces. */
function niceMax(value, ticks = 4) {
  if (value <= 0) return 1;
  const raw = value / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return step * ticks;
}

function tooltip(host) {
  const box = document.createElement('div');
  box.className = 'tip';
  box.hidden = true;
  host.appendChild(box);
  return {
    show(html, xFrac, yFrac) {
      box.innerHTML = html;
      box.hidden = false;
      box.style.left = `${xFrac * 100}%`;
      box.style.top = `${yFrac * 100}%`;
      box.classList.toggle('flip', xFrac > 0.62);
    },
    hide() { box.hidden = true; },
  };
}

/* ------------------------------------------------------------------ line -- */
/** series: [{ key, label, color, points: [{x: isoDate, y: number, n: number}] }] */
export function lineChart(host, { series, yLabel, yMax, yFormat = (v) => v, xTicks = 4 }) {
  host.classList.add('chart');
  const svg = el('svg', {
    viewBox: `0 0 ${VB.w} ${VB.h}`, class: 'chart-svg',
    role: 'img', 'aria-label': yLabel,
  });

  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  const xAt = (iso) => PAD.left + (xs.indexOf(iso) / Math.max(1, xs.length - 1)) * plot.w;
  const top = yMax ?? niceMax(Math.max(...series.flatMap((s) => s.points.map((p) => p.y))) * 1.1);
  const yAt = (v) => PAD.top + plot.h - (v / top) * plot.h;

  // grid + y ticks (recessive)
  for (let i = 0; i <= 4; i++) {
    const v = (top / 4) * i;
    const y = yAt(v);
    svg.appendChild(el('line', {
      x1: PAD.left, x2: PAD.left + plot.w, y1: y, y2: y, class: 'grid',
    }));
    const label = el('text', { x: PAD.left - 8, y: y + 4, class: 'tick tick-y' });
    label.textContent = yFormat(v);
    svg.appendChild(label);
  }

  // baseline
  svg.appendChild(el('line', {
    x1: PAD.left, x2: PAD.left + plot.w, y1: yAt(0), y2: yAt(0), class: 'axis',
  }));

  // x ticks: first, last, and evenly spaced between -- never one per point
  const step = Math.max(1, Math.round((xs.length - 1) / xTicks));
  xs.forEach((iso, i) => {
    if (i % step !== 0 && i !== xs.length - 1) return;
    const label = el('text', { x: xAt(iso), y: VB.h - 12, class: 'tick tick-x' });
    label.textContent = shortDate(iso);
    svg.appendChild(label);
  });

  for (const s of series) {
    const pts = s.points.slice().sort((a, b) => a.x.localeCompare(b.x));
    svg.appendChild(el('path', {
      d: pts.map((p, i) => `${i ? 'L' : 'M'}${xAt(p.x)} ${yAt(p.y)}`).join(' '),
      class: 'line', style: `stroke: ${s.color}`,
    }));
    for (const p of pts) {
      svg.appendChild(el('circle', {
        cx: xAt(p.x), cy: yAt(p.y), r: 3, class: 'dot', style: `fill: ${s.color}`,
      }));
    }
    // direct label at the line end, so identity never rests on colour alone
    const last = pts[pts.length - 1];
    const label = el('text', {
      x: xAt(last.x) + 10, y: yAt(last.y) + 4, class: 'series-label',
      style: `fill: ${s.color}`,
    });
    label.textContent = s.label;
    svg.appendChild(label);
  }

  const crosshair = el('line', { class: 'crosshair', y1: PAD.top, y2: PAD.top + plot.h, hidden: '' });
  svg.appendChild(crosshair);
  host.appendChild(svg);

  const tip = tooltip(host);
  svg.addEventListener('pointerleave', () => { tip.hide(); crosshair.setAttribute('hidden', ''); });
  svg.addEventListener('pointermove', (event) => {
    const rect = svg.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / rect.width) * VB.w;
    // nearest x slot -- a hit target far wider than the 3px dot
    const idx = Math.min(xs.length - 1, Math.max(0,
      Math.round(((vx - PAD.left) / plot.w) * (xs.length - 1))));
    const iso = xs[idx];
    crosshair.removeAttribute('hidden');
    crosshair.setAttribute('x1', xAt(iso));
    crosshair.setAttribute('x2', xAt(iso));

    const rows = series
      .map((s) => ({ s, p: s.points.find((q) => q.x === iso) }))
      .filter((r) => r.p);
    if (!rows.length) { tip.hide(); return; }
    tip.show(
      `<strong>week of ${shortDate(iso)}</strong>`
      + rows.map((r) => `<span class="tip-row"><i style="background:${r.s.color}"></i>`
        + `${r.s.label} <b>${yFormat(r.p.y)}</b>`
        + (r.p.n != null ? ` <em>n=${r.p.n}</em>` : '') + '</span>').join(''),
      xAt(iso) / VB.w, yAt(rows[0].p.y) / VB.h,
    );
  });
}

/* ------------------------------------------------------------------- bar -- */
/** bars: [{ label, value, n, note }] -- one series, so one colour and no legend */
export function barChart(host, { bars, yFormat = (v) => v, yMax, color }) {
  host.classList.add('chart');
  const pad = { ...PAD, right: 24 };
  const width = VB.w - pad.left - pad.right;
  const svg = el('svg', { viewBox: `0 0 ${VB.w} ${VB.h}`, class: 'chart-svg', role: 'img' });

  const top = yMax ?? (niceMax(Math.max(...bars.map((b) => b.value)) * 1.15) || 1);
  const yAt = (v) => pad.top + plot.h - (v / top) * plot.h;

  for (let i = 0; i <= 4; i++) {
    const y = yAt((top / 4) * i);
    svg.appendChild(el('line', { x1: pad.left, x2: pad.left + width, y1: y, y2: y, class: 'grid' }));
    const label = el('text', { x: pad.left - 8, y: y + 4, class: 'tick tick-y' });
    label.textContent = yFormat((top / 4) * i);
    svg.appendChild(label);
  }
  svg.appendChild(el('line', {
    x1: pad.left, x2: pad.left + width, y1: yAt(0), y2: yAt(0), class: 'axis',
  }));

  const slot = width / bars.length;
  const barW = Math.min(64, slot * 0.5);
  const tip = tooltip(host);

  bars.forEach((b, i) => {
    const cx = pad.left + slot * (i + 0.5);
    const h = Math.max(0, yAt(0) - yAt(b.value));
    // 4px rounded ends, anchored to the baseline: draw the full radius and
    // clip the bottom by overdrawing 4px below the baseline.
    const g = el('g', { class: 'bar-group', tabindex: '0' });
    // A zero value gets no mark at all. Drawing the 4px corner radius at the
    // baseline would render a visible stub that reads as "small but nonzero".
    if (b.value > 0) {
      g.appendChild(el('rect', {
        x: cx - barW / 2, y: yAt(b.value), width: barW, height: h + 4,
        rx: 4, class: 'bar', style: `fill: ${color}`,
      }));
    }
    // sample size, directly on the mark -- these buckets are small and hiding
    // that would be dishonest
    const n = el('text', { x: cx, y: yAt(b.value) - 8, class: 'bar-n' });
    if (b.value === 0) n.setAttribute('class', 'bar-n bar-n-zero');
    n.textContent = b.value === 0 ? `0 · n=${b.n}` : `n=${b.n}`;
    g.appendChild(n);

    const label = el('text', { x: cx, y: VB.h - 12, class: 'tick tick-x' });
    label.textContent = b.label;
    g.appendChild(label);

    const showTip = () => tip.show(
      `<strong>${b.label}</strong><span class="tip-row"><b>${yFormat(b.value)}</b>`
      + ` <em>over ${b.n} repeat attempt${b.n === 1 ? '' : 's'}</em></span>`
      + (b.note ? `<span class="tip-note">${b.note}</span>` : ''),
      cx / VB.w, yAt(b.value) / VB.h,
    );
    g.addEventListener('pointerenter', showTip);
    g.addEventListener('focus', showTip);
    g.addEventListener('pointerleave', tip.hide);
    g.addEventListener('blur', tip.hide);
    svg.appendChild(g);
  });

  host.appendChild(svg);
  svg.addEventListener('pointerleave', tip.hide);
}

/* ------------------------------------------------- proportion (one bar) -- */
export function proportionBar(value, total, { color } = {}) {
  const pct = total ? (value / total) * 100 : 0;
  const wrap = document.createElement('span');
  wrap.className = 'prop';
  wrap.innerHTML = `<span class="prop-track"><span class="prop-fill" style="width:${pct}%${color ? `;background:${color}` : ''}"></span></span>`;
  return wrap;
}

/* ------------------------------------------------------------- data view -- */
export function dataTable(host, { columns, rows, caption }) {
  const details = document.createElement('details');
  details.className = 'data-view';
  const summary = document.createElement('summary');
  summary.textContent = 'Show the numbers';
  details.appendChild(summary);

  const table = document.createElement('table');
  if (caption) {
    const cap = document.createElement('caption');
    cap.textContent = caption;
    table.appendChild(cap);
  }
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>${columns.map((c) => `<th scope="col">${c}</th>`).join('')}</tr>`;
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    tbody.innerHTML += `<tr>${row.map((cell, i) => (i === 0
      ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`)).join('')}</tr>`;
  }
  table.appendChild(tbody);
  // Wide tables get their own horizontal scroller. Without this the data view
  // pushes the whole page sideways at phone width.
  const scroller = document.createElement('div');
  scroller.className = 'table-scroll';
  scroller.appendChild(table);
  details.appendChild(scroller);
  host.appendChild(details);
}
