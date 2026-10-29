// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

const EN_DASH = '–';

// Team and manager names come from Yahoo, so make them safe to drop into HTML.
function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function fmtPts(n) {
  return n.toFixed(1);
}

// Single-game scores have two decimals on Yahoo, so show both.
function fmtScore(n) {
  return n.toFixed(2);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function yearRange(start, end) {
  return start === end ? `${start}` : `${start}${EN_DASH}${end}`;
}

// ---------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------

async function loadData() {
  const res = await fetch('data/league_history.json');
  if (!res.ok) throw new Error('Could not load league_history.json');
  return res.json();
}

// ---------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------

function computeAllTime(seasons) {
  const byManager = {};

  function getManager(name) {
    if (!byManager[name]) {
      byManager[name] = {
        manager: name,
        wins: 0, losses: 0, ties: 0,
        pointsFor: 0, pointsAgainst: 0,
        titles: 0,
        finishes: [],
      };
    }
    return byManager[name];
  }

  for (const season of seasons) {
    for (const team of season.teams) {
      const m = getManager(team.manager);
      m.wins += team.wins;
      m.losses += team.losses;
      m.ties += team.ties;
      m.pointsFor += team.points_for;
      m.pointsAgainst += team.points_against;
      m.finishes.push(team.rank);
      if (team.rank === 1) m.titles += 1;
    }
  }

  return Object.values(byManager).map(m => {
    const gp = m.wins + m.losses + m.ties;
    const winPct = gp > 0 ? (m.wins + m.ties * 0.5) / gp : 0;
    const avgFinish = m.finishes.length
      ? m.finishes.reduce((a, b) => a + b, 0) / m.finishes.length
      : null;
    return { ...m, winPct, avgFinish };
  });
}

function allGamesChronological(seasons) {
  const games = [];
  for (const season of seasons) {
    for (const mu of season.matchups) {
      games.push({ year: season.year, ...mu });
    }
  }
  games.sort((a, b) => a.year - b.year || a.week - b.week);
  return games;
}

function computeRecords(seasons) {
  const games = allGamesChronological(seasons);
  if (games.length === 0) return null;

  let biggestBlowout = null, highestScore = null;
  const decided = [];   // games with a real winner, for the closest-games list

  for (const g of games) {
    const p1 = g.team1_points, p2 = g.team2_points;
    const diff = round2(Math.abs(p1 - p2));
    const team1Won = p1 > p2;
    const info = {
      diff,
      year: g.year,
      week: g.week,
      winner: team1Won ? g.team1_manager : g.team2_manager,
      loser: team1Won ? g.team2_manager : g.team1_manager,
      winnerPts: Math.max(p1, p2),
      loserPts: Math.min(p1, p2),
      playoffs: !!g.is_playoffs,
    };

    if (!biggestBlowout || diff > biggestBlowout.diff) biggestBlowout = info;

    // A tie (no margin at all) can never count as a close game.
    if (diff > 0) decided.push(info);

    if (!highestScore || p1 > highestScore.points) {
      highestScore = { points: p1, manager: g.team1_manager, year: g.year, week: g.week };
    }
    if (p2 > highestScore.points) {
      highestScore = { points: p2, manager: g.team2_manager, year: g.year, week: g.week };
    }
  }

  const closestGames = decided
    .sort((a, b) => a.diff - b.diff || a.year - b.year || a.week - b.week)
    .slice(0, 5);

  // Longest streaks, per manager, in chronological order. Each streak keeps
  // track of where it started and ended so we can show the years.
  const perManagerGames = {};
  for (const g of games) {
    for (const [manager, points, oppPoints] of [
      [g.team1_manager, g.team1_points, g.team2_points],
      [g.team2_manager, g.team2_points, g.team1_points],
    ]) {
      if (!perManagerGames[manager]) perManagerGames[manager] = [];
      let result = 'T';
      if (points > oppPoints) result = 'W';
      else if (points < oppPoints) result = 'L';
      perManagerGames[manager].push({ year: g.year, week: g.week, result });
    }
  }

  let longestWinStreak = { manager: null, length: 0, start: null, end: null };
  let longestLossStreak = { manager: null, length: 0, start: null, end: null };

  for (const [manager, gameList] of Object.entries(perManagerGames)) {
    let win = null, loss = null;   // the streak currently running, if any
    for (const g of gameList) {
      const here = { year: g.year, week: g.week };
      if (g.result === 'W') {
        win = win ? { length: win.length + 1, start: win.start } : { length: 1, start: here };
        loss = null;
        if (win.length > longestWinStreak.length) {
          longestWinStreak = { manager, length: win.length, start: win.start, end: here };
        }
      } else if (g.result === 'L') {
        loss = loss ? { length: loss.length + 1, start: loss.start } : { length: 1, start: here };
        win = null;
        if (loss.length > longestLossStreak.length) {
          longestLossStreak = { manager, length: loss.length, start: loss.start, end: here };
        }
      } else {
        win = null;
        loss = null;
      }
    }
  }

  // Best single-season points total
  let bestSeasonPoints = null;
  for (const season of seasons) {
    for (const team of season.teams) {
      if (!bestSeasonPoints || team.points_for > bestSeasonPoints.points) {
        bestSeasonPoints = { points: team.points_for, manager: team.manager, year: season.year };
      }
    }
  }

  return { biggestBlowout, closestGames, highestScore, longestWinStreak, longestLossStreak, bestSeasonPoints };
}

function computeHeadToHead(seasons, managerA, managerB) {
  const games = allGamesChronological(seasons).filter(g =>
    (g.team1_manager === managerA && g.team2_manager === managerB) ||
    (g.team1_manager === managerB && g.team2_manager === managerA)
  );

  let aWins = 0, bWins = 0, ties = 0;
  const log = games.map(g => {
    const aIsTeam1 = g.team1_manager === managerA;
    const aPts = aIsTeam1 ? g.team1_points : g.team2_points;
    const bPts = aIsTeam1 ? g.team2_points : g.team1_points;
    let winner = null;
    if (aPts > bPts) { aWins++; winner = managerA; }
    else if (bPts > aPts) { bWins++; winner = managerB; }
    else { ties++; }
    return { year: g.year, week: g.week, aPts, bPts, winner };
  });

  return { aWins, bWins, ties, log };
}

// Each manager's team names, oldest first. Back-to-back years with the same
// name are folded into one line (e.g. 2014-2015).
function computeTeamNameHistory(seasons) {
  const byManager = {};
  [...seasons].sort((a, b) => a.year - b.year).forEach(season => {
    season.teams.forEach(team => {
      if (!byManager[team.manager]) byManager[team.manager] = [];
      byManager[team.manager].push({ year: season.year, name: team.team_name || 'Unknown team' });
    });
  });

  return Object.entries(byManager)
    .map(([manager, entries]) => {
      const groups = [];
      for (const e of entries) {
        const last = groups[groups.length - 1];
        if (last && last.name === e.name && e.year === last.end + 1) {
          last.end = e.year;
        } else {
          groups.push({ name: e.name, start: e.year, end: e.year });
        }
      }
      return {
        manager,
        seasons: entries.length,
        first: entries[0].year,
        last: entries[entries.length - 1].year,
        groups,
      };
    })
    .sort((a, b) => a.manager.localeCompare(b.manager, undefined, { sensitivity: 'base' }));
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderHero(data) {
  document.getElementById('league-name').textContent = data.league_name;
  document.getElementById('hero-title').textContent = `${data.league_name}: ${data.seasons.length} seasons of history`;

  const totalGames = data.seasons.reduce((sum, s) => sum + s.matchups.length, 0);
  const totalManagers = new Set(
    data.seasons.flatMap(s => s.teams.map(t => t.manager))
  ).size;
  const years = data.seasons.map(s => s.year);
  const span = `${Math.min(...years)}${EN_DASH}${Math.max(...years)}`;

  const stats = [
    { value: data.seasons.length, label: 'seasons' },
    { value: totalGames, label: 'games played' },
    { value: totalManagers, label: 'managers' },
    { value: span, label: 'years' },
  ];

  document.getElementById('hero-stats').innerHTML = stats.map(s => `
    <div class="hero-stat">
      <span class="value">${esc(s.value)}</span>
      <span class="label">${esc(s.label)}</span>
    </div>
  `).join('');
}

function renderStandings(data) {
  const latest = data.seasons[data.seasons.length - 1];
  document.getElementById('standings-year').textContent = `${latest.year} season`;

  const rows = [...latest.teams].sort((a, b) => a.rank - b.rank);
  const tbody = document.querySelector('#standings-table tbody');
  tbody.innerHTML = rows.map(t => `
    <tr>
      <td class="${t.rank === 1 ? 'rank-1' : ''}">${t.rank}</td>
      <td>${esc(t.manager)}</td>
      <td>${esc(t.team_name)}</td>
      <td>${t.wins}-${t.losses}${t.ties ? '-' + t.ties : ''}</td>
      <td>${fmtPts(t.points_for)}</td>
      <td>${fmtPts(t.points_against)}</td>
    </tr>
  `).join('');
}

// First click on a column sorts "biggest first", except where smaller is
// better (average finish) or alphabetical makes more sense (manager name).
const ALLTIME_FIRST_DIRECTION = {
  manager: 'asc',
  record: 'desc',
  winPct: 'desc',
  titles: 'desc',
  pointsFor: 'desc',
  pointsAgainst: 'desc',
  avgFinish: 'asc',
};

function allTimeSortValue(row, key) {
  if (key === 'manager') return row.manager.toLowerCase();
  if (key === 'record') return row.wins;
  return row[key];
}

function compareAllTime(a, b, key, dir) {
  const va = allTimeSortValue(a, key);
  const vb = allTimeSortValue(b, key);

  // Missing values (no finish data) always sink to the bottom.
  const aEmpty = va == null, bEmpty = vb == null;
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : (aEmpty ? 1 : -1);

  const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
  if (c !== 0) return dir === 'asc' ? c : -c;

  // Ties: better win % first, then name.
  return (b.winPct - a.winPct) || a.manager.localeCompare(b.manager);
}

function renderAllTime(seasons) {
  const rows = computeAllTime(seasons);
  const table = document.getElementById('alltime-table');
  const tbody = table.querySelector('tbody');
  const headers = [...table.querySelectorAll('thead th')];
  let sort = { key: 'winPct', dir: 'desc' };

  function draw() {
    const sorted = [...rows].sort((a, b) => compareAllTime(a, b, sort.key, sort.dir));
    tbody.innerHTML = sorted.map(r => `
      <tr>
        <td>${esc(r.manager)}</td>
        <td>${r.wins}-${r.losses}${r.ties ? '-' + r.ties : ''}</td>
        <td>${(r.winPct * 100).toFixed(1)}%</td>
        <td>${r.titles}</td>
        <td>${fmtPts(r.pointsFor)}</td>
        <td>${fmtPts(r.pointsAgainst)}</td>
        <td>${r.avgFinish != null ? r.avgFinish.toFixed(1) : '—'}</td>
      </tr>
    `).join('');

    headers.forEach(th => {
      const active = th.dataset.key === sort.key;
      th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
  }

  headers.forEach(th => {
    th.querySelector('.sort-btn').addEventListener('click', () => {
      const key = th.dataset.key;
      if (sort.key === key) {
        sort = { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' };
      } else {
        sort = { key, dir: ALLTIME_FIRST_DIRECTION[key] || 'desc' };
      }
      draw();
    });
  });

  draw();
}

function fmtSpan(start, end) {
  if (!start || !end) return '';
  if (start.year === end.year) {
    return start.week === end.week
      ? `${start.year}, Week ${start.week}`
      : `${start.year}, Weeks ${start.week}${EN_DASH}${end.week}`;
  }
  return `Week ${start.week}, ${start.year} to Week ${end.week}, ${end.year}`;
}

function renderRecords(seasons) {
  const rec = computeRecords(seasons);
  const grid = document.getElementById('records-grid');
  if (!rec) { grid.innerHTML = '<p>Not enough data yet.</p>'; return; }

  const streakCard = (label, streak) => ({
    label,
    value: streak.length ? plural(streak.length, 'game') : '—',
    context: streak.length
      ? `${esc(streak.manager)} · ${esc(fmtSpan(streak.start, streak.end))}`
      : '—',
  });

  const b = rec.biggestBlowout;
  const cards = [
    {
      label: 'Biggest Blowout',
      value: `${fmtScore(b.diff)} pts`,
      context: `${esc(b.winner)} beat ${esc(b.loser)} `
        + `${fmtScore(b.winnerPts)}${EN_DASH}${fmtScore(b.loserPts)} `
        + `(Week ${b.week}, ${b.year})`,
    },
    {
      label: 'Highest Single-Game Score',
      value: fmtScore(rec.highestScore.points),
      context: `${esc(rec.highestScore.manager)}, Week ${rec.highestScore.week}, ${rec.highestScore.year}`,
    },
    {
      label: 'Best Season Points Total',
      value: fmtPts(rec.bestSeasonPoints.points),
      context: `${esc(rec.bestSeasonPoints.manager)}, ${rec.bestSeasonPoints.year}`,
    },
    streakCard('Longest Win Streak', rec.longestWinStreak),
    streakCard('Longest Losing Streak', rec.longestLossStreak),
  ];

  const cardHtml = cards.map(c => `
    <div class="record-card">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      <div class="context">${c.context}</div>
    </div>
  `).join('');

  const closestItems = rec.closestGames.map((g, i) => `
    <li>
      <span class="n">${i + 1}</span>
      <span class="margin">${fmtScore(g.diff)} pts</span>
      <span class="detail">
        ${esc(g.winner)} beat ${esc(g.loser)} ${fmtScore(g.winnerPts)}${EN_DASH}${fmtScore(g.loserPts)}
        <span class="when">Week ${g.week}, ${g.year}${g.playoffs ? ' · Playoffs' : ''}</span>
      </span>
    </li>
  `).join('');

  const closestHtml = `
    <div class="record-card wide">
      <div class="label">Five Closest Games</div>
      ${closestItems
        ? `<ol class="closest-list">${closestItems}</ol>`
        : '<div class="context">No decided games yet.</div>'}
    </div>
  `;

  grid.innerHTML = cardHtml + closestHtml;
}

function renderH2H(seasons) {
  const managers = [...new Set(seasons.flatMap(s => s.teams.map(t => t.manager)))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const selA = document.getElementById('h2h-manager-a');
  const selB = document.getElementById('h2h-manager-b');

  const options = managers.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  selA.innerHTML = options;
  selB.innerHTML = options;
  if (managers.length > 1) selB.selectedIndex = 1;

  function update() {
    const a = selA.value, b = selB.value;
    const result = document.getElementById('h2h-result');
    if (a === b) {
      result.innerHTML = '<p>Pick two different managers.</p>';
      return;
    }
    const h2h = computeHeadToHead(seasons, a, b);
    if (h2h.log.length === 0) {
      result.innerHTML = `<p>${esc(a)} and ${esc(b)} haven't played each other yet.</p>`;
      return;
    }
    const summary = `${esc(a)} ${h2h.aWins} ${EN_DASH} ${h2h.bWins} ${esc(b)}`
      + (h2h.ties ? ` (${plural(h2h.ties, 'tie')})` : '');
    const rows = h2h.log.map(g => `
      <div class="game-row">
        <span>${g.year}, Week ${g.week}</span>
        <span>${g.aPts.toFixed(1)} ${EN_DASH} ${g.bPts.toFixed(1)}</span>
        <span class="winner">${g.winner ? esc(g.winner) + ' won' : 'Tie'}</span>
      </div>
    `).join('');
    result.innerHTML = `<div class="h2h-summary">${summary}</div><div class="h2h-log">${rows}</div>`;
  }

  selA.addEventListener('change', update);
  selB.addEventListener('change', update);
  update();
}

function renderManagers(seasons) {
  const history = computeTeamNameHistory(seasons);
  const select = document.getElementById('manager-select');
  const detail = document.getElementById('manager-detail');

  if (history.length === 0) {
    select.innerHTML = '';
    detail.innerHTML = '<p>No manager data yet.</p>';
    return;
  }

  select.innerHTML = history
    .map((h, i) => `<option value="${i}">${esc(h.manager)}</option>`)
    .join('');

  function show() {
    const h = history[Number(select.value)];
    if (!h) { detail.innerHTML = ''; return; }

    const rows = h.groups.map(g => `
      <li>
        <span class="yrs">${yearRange(g.start, g.end)}</span>
        <span class="tname">${esc(g.name)}</span>
      </li>
    `).join('');

    detail.innerHTML = `
      <article class="manager-card">
        <h3>${esc(h.manager)}</h3>
        <div class="manager-meta">${plural(h.seasons, 'season')} · ${yearRange(h.first, h.last)}</div>
        <ol class="team-history">${rows}</ol>
      </article>
    `;
  }

  select.addEventListener('change', show);
  show();
}

function renderTimeline(seasons) {
  const host = document.getElementById('timeline-chart');
  const years = seasons.map(s => s.year).sort((a, b) => a - b);
  const info = {};
  seasons.forEach(s => {
    s.teams.forEach(t => {
      const m = info[t.manager] = info[t.manager] || { name: t.manager, played: {} };
      m.played[s.year] = t.rank === 1 ? 'champ' : 'in';
    });
  });
  const rows = Object.values(info).map(m => {
    const ys = Object.keys(m.played).map(Number);
    return { ...m, first: Math.min(...ys), count: ys.length };
  }).sort((a, b) => a.first - b.first || b.count - a.count || a.name.localeCompare(b.name));
  // Spread colors around the color wheel so neighbors differ.
  rows.forEach((r, i) => {
    const hue = Math.round((i * 137.508) % 360);
    const light = [48, 40, 56][i % 3];
    r.color = `hsl(${hue}, 65%, ${light}%)`;
  });
  const head = years.map(y => `<th scope="col">${y}</th>`).join('');
  const body = rows.map(r => {
    const cells = years.map(y => {
      const st = r.played[y];
      if (!st) return '<td></td>';
      const label = `${esc(r.name)}, ${y}${st === 'champ' ? ' (champion)' : ''}`;
      return st === 'champ'
        ? `<td class="champ" title="${label}"></td>`
        : `<td style="background:${r.color}" title="${label}"></td>`;
    }).join('');
    return `<tr><th scope="row">${esc(r.name)}</th>${cells}</tr>`;
  }).join('');
  host.innerHTML = `<table class="timeline"><thead><tr><td></td>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// ---------------------------------------------------------------------
// Draft & player data (optional: only shown if data/players.json exists)
// ---------------------------------------------------------------------
async function loadPlayers() {
  try {
    const res = await fetch('data/players.json');
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

const fmtValue = v => v === null || v === undefined
  ? '—'
  : `<span class="${v > 0 ? 'val-up' : v < 0 ? 'val-down' : ''}">${v > 0 ? '+' : v < 0 ? '\u2212' : ''}${Math.abs(v)}</span>`;

const pickedUpBy = teams => {
  const t = teams || [];
  return t.length ? `picked up by ${esc(t.slice(0, 2).join(' / '))}${t.length > 2 ? ` +${t.length - 2}` : ''}` : '';
};

function renderDraft(players) {
  const section = document.getElementById('draft');
  const tab = document.getElementById('draft-tab');
  const select = document.getElementById('draft-select');
  const detail = document.getElementById('draft-detail');
  const years = Object.keys(players.seasons).sort((a, b) => b - a);
  if (!years.length) return;
  section.hidden = false;
  tab.hidden = false;
  select.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');

  function show() {
    const s = players.seasons[select.value];
    const champ = s.champion;
    const champCard = champ ? `
      <div class="record-card">
        <div class="label">Best player on the champion's roster</div>
        <div class="value">${esc(champ.player)}</div>
        <div class="context">${fmtPts(champ.pts)} pts as a starter for ${esc(champ.manager)} (${esc(champ.team)})</div>
      </div>` : '';
    const tops = s.topPlayers.map((p, i) => `
      <li><span>${i + 1}. ${esc(p.player)} <span class="pos-tag">${esc(p.pos || '')}
        (${p.pick ? `${esc(p.draftedBy)}, Pick ${p.pick}` : `Undrafted, ${esc((p.teams || []).join(' / ') || 'free agent')}`})</span></span>
      <span>${fmtPts(p.pts)}</span></li>`).join('');
    const undrafted = (s.topUndrafted || []).map((p, i) => `
      <li><span>${i + 1}. ${esc(p.player)} <span class="pos-tag">${esc(p.pos || '')} (${pickedUpBy(p.teams)})</span></span>
      <span>${fmtPts(p.pts)}</span></li>`).join('');
    const ROUNDS_STEP = 2;
    const maxRound = Math.max(...s.draft.map(p => p.round));
    const rowsFor = limit => s.draft.filter(p => p.round <= limit).map(p => `
      <tr>
        <td class="num">${p.pick}</td>
        <td class="num">${p.round}</td>
        <td>${esc(p.manager)}</td>
        <td>${esc(p.player)} <span class="pos-tag">${esc(p.pos || '')}</span></td>
        <td class="num">${p.pts === null ? '—' : fmtPts(p.pts)}</td>
        <td class="num">${p.rank === null ? '—' : p.rank}</td>
        <td class="num">${fmtValue(p.value)}</td>
      </tr>`).join('');
    detail.innerHTML = `
      <div class="draft-grid">
        ${champCard}
        <div class="record-card">
          <div class="label">Top scorers this season</div>
          <ol class="mini-list" style="list-style:none">${tops}</ol>
        </div>
        ${(s.topUndrafted || []).length ? `
        <div class="record-card">
          <div class="label">Top undrafted players this season</div>
          <ol class="mini-list" style="list-style:none">${undrafted}</ol>
        </div>` : ''}
      </div>
      <div class="table-wrap">
        <table class="draft-table">
          <thead><tr><th class="num">Pick</th><th class="num">Rd</th><th>Manager</th><th>Player</th><th class="num">Points</th><th class="num">Finish</th><th class="num">Value</th></tr></thead>
          <tbody id="draft-rows"></tbody>
        </table>
      </div>
      <div class="draft-more"><button type="button" class="more-btn" id="draft-more-btn"></button></div>`;

    let shown = ROUNDS_STEP;
    const body = document.getElementById('draft-rows');
    const btn = document.getElementById('draft-more-btn');
    function paint() {
      body.innerHTML = rowsFor(shown);
      if (maxRound <= ROUNDS_STEP) { btn.hidden = true; return; }
      btn.hidden = false;
      btn.textContent = shown >= maxRound
        ? 'Show fewer rounds'
        : `Show rounds ${shown + 1}\u2013${Math.min(shown + ROUNDS_STEP, maxRound)} (of ${maxRound})`;
    }
    btn.addEventListener('click', () => {
      shown = shown >= maxRound ? ROUNDS_STEP : shown + ROUNDS_STEP;
      paint();
    });
    paint();
  }
  select.addEventListener('change', show);
  show();
}

function renderPlayerRecords(players) {
  const grid = document.getElementById('records-grid');
  const r = players.records;
  const draftItems = list => list.map((p, i) => `
    <li>
      <span class="n">${i + 1}</span>
      <span class="margin">${p.value > 0 ? '+' : '\u2212'}${Math.abs(p.value)}</span>
      <span class="detail">${esc(p.player)} <span class="pos-tag">${esc(p.pos || '')}</span> &mdash; ${esc(p.manager)}
        <span class="when">${p.year}, pick ${p.pick} (round ${p.round}), finished #${p.rank} in points</span>
      </span>
    </li>`).join('');
  const lowItems = r.lowestFullLineup.map((g, i) => `
    <li>
      <span class="n">${i + 1}</span>
      <span class="margin">${fmtScore(g.pts)}</span>
      <span class="detail">${esc(g.manager)}
        <span class="when">Week ${g.week}, ${g.year}${g.playoffs ? ' \u00B7 Playoffs' : ''}</span>
      </span>
    </li>`).join('');
  const undItems = (r.undrafted || []).map((p, i) => `
    <li>
      <span class="n">${i + 1}</span>
      <span class="margin">${fmtPts(p.pts)}</span>
      <span class="detail">${esc(p.player)} <span class="pos-tag">${esc(p.pos || '')}</span>
        <span class="when">${p.year}, ${pickedUpBy(p.teams)}</span>
      </span>
    </li>`).join('');
  const champItems = r.championTopPlayers.slice(0, 5).map((p, i) => `
    <li>
      <span class="n">${i + 1}</span>
      <span class="margin">${fmtPts(p.pts)}</span>
      <span class="detail">${esc(p.player)} <span class="pos-tag">${esc(p.pos || '')}</span> &mdash; ${esc(p.manager)}
        <span class="when">${p.year} champion (${esc(p.team)})</span>
      </span>
    </li>`).join('');
  const card = (title, items, note) => `
    <div class="record-card wide">
      <div class="label">${title}</div>
      <ol class="closest-list">${items}</ol>
      ${note ? `<p class="record-note">${note}</p>` : ''}
    </div>`;
  grid.innerHTML += card('Lowest Scores With a Set Lineup', lowItems, '')
    + card('Biggest Draft Steals', draftItems(r.steals),
      'Pick number minus finish in season points among all players drafted that year. Kickers and defenses not counted.')
    + card('Biggest Draft Busts', draftItems(r.busts), '')
    + (undItems ? card('Best Undrafted Players', undItems,
      'Players nobody drafted, ranked by season points. Kickers and defenses not counted.') : '')
    + card('Most Points From One Player on a Championship Team', champItems,
      'Points scored while in a starting lineup spot.');
}

function renderHistory(seasons) {
  const list = document.getElementById('history-list');
  const sorted = [...seasons].sort((a, b) => b.year - a.year);
  const multipleLeagues = new Set(seasons.map(s => s.league_name)).size > 1;

  list.innerHTML = sorted.map(season => {
    const sortedTeams = [...season.teams].sort((a, b) => a.rank - b.rank);
    const champion = sortedTeams[0];
    const runnerUp = sortedTeams[1];
    return `
      <div class="season-block">
        <div class="season-year">${season.year}</div>
        <div class="season-details">
          <div class="champion">${champion ? esc(champion.manager) + ' — ' + esc(champion.team_name) : 'No data'}</div>
          ${runnerUp ? `<div class="runner-up">Runner-up: ${esc(runnerUp.manager)}</div>` : ''}
          ${multipleLeagues ? `<div class="runner-up">${esc(season.league_name)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function setupTabs() {
  const links = document.querySelectorAll('.tab-link');
  links.forEach(link => {
    link.addEventListener('click', () => {
      const target = document.getElementById(link.dataset.target);
      target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  const sections = [...document.querySelectorAll('.section')];
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        links.forEach(l => l.classList.toggle('active', l.dataset.target === entry.target.id));
      }
    });
  }, { rootMargin: '-40% 0px -50% 0px' });
  sections.forEach(s => observer.observe(s));
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------

async function init() {
  try {
    const data = await loadData();
    renderHero(data);
    renderStandings(data);
    renderAllTime(data.seasons);
    renderRecords(data.seasons);
    renderH2H(data.seasons);
    renderManagers(data.seasons);
    const players = await loadPlayers();
    if (players) { renderPlayerRecords(players); renderDraft(players); }
    renderTimeline(data.seasons);
    renderHistory(data.seasons);
    setupTabs();
  } catch (err) {
    document.getElementById('hero-title').textContent = 'Could not load league data.';
    console.error(err);
  }
}

init();
