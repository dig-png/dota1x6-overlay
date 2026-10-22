'use strict';

const HERO_CDN = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes';

const els = {
  input: document.getElementById('ids'),
  load: document.getElementById('btn-load'),
  status: document.getElementById('status'),
  cards: document.getElementById('cards'),
  passthrough: document.getElementById('btn-passthrough'),
  hide: document.getElementById('btn-hide'),
  close: document.getElementById('btn-close'),
};

const STORAGE_KEY = 'dota1x6-overlay:ids';

let busy = false;

/* ---------- utils ---------- */

const fmtInt = (value) => Number(value || 0).toLocaleString('ru-RU');
const fmtFloat = (value, digits = 2) => Number(value || 0).toFixed(digits);
const fmtPercent = (value) => `${Math.round(Number(value || 0) * 100)}%`;

function prettifyHero(name) {
  return String(name || '')
    .replace(/^npc_dota_hero_/, '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function heroIcon(file) {
  return `${HERO_CDN}/${file}.png`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStatus(text, isError = false) {
  els.status.textContent = text || '';
  els.status.classList.toggle('error', Boolean(isError));
}

/* ---------- render ---------- */

function renderCard(player) {
  const card = el('div', 'card');
  card.title = `Открыть профиль на dota1x6.com (${player.accountId})`;
  card.addEventListener('click', () => window.overlay.openExternal(player.profileUrl));

  // верхняя строка
  const top = el('div', 'card-top');

  const avatar = el('img', 'avatar');
  avatar.src = player.avatar || '';
  avatar.alt = '';
  avatar.addEventListener('error', () => {
    avatar.style.visibility = 'hidden';
  });
  top.append(avatar);

  const ident = el('div', 'ident');
  ident.append(el('div', 'nick', player.name));

  const sub = el('div', 'sub');
  if (player.leaderboardPlace) {
    sub.append(el('span', 'lb', `#${player.leaderboardPlace} в ладдере`));
  }
  sub.append(el('span', null, `${fmtInt(player.matchCount)} матчей`));
  if (player.duoRating) sub.append(el('span', null, `дуо ${fmtInt(player.duoRating)}`));
  ident.append(sub);
  top.append(ident);

  const rating = el('div', 'rating');
  rating.append(el('b', null, fmtInt(player.rating)));
  rating.append(el('span', null, 'рейтинг'));
  top.append(rating);

  card.append(top);

  // метрики
  const metrics = el('div', 'metrics');
  const metric = (label, value) => {
    const box = el('div', 'metric');
    box.append(el('span', null, label));
    box.append(el('b', null, value));
    return box;
  };
  metrics.append(metric('ср. место', fmtFloat(player.avgPlace)));
  metrics.append(metric('1-е места', fmtPercent(player.firstRate)));
  metrics.append(metric('в топ-3', fmtPercent(player.top3Rate)));
  card.append(metrics);

  // пул героев
  if (player.heroes.length) {
    const pool = el('div', 'pool');
    for (const hero of player.heroes) {
      const chip = el('div', 'hero-chip');
      const img = el('img');
      img.src = heroIcon(hero.file);
      img.alt = prettifyHero(hero.name);
      img.addEventListener('error', () => img.remove());
      chip.append(img);
      chip.append(el('span', null, `×${hero.games}`));
      chip.title = `${prettifyHero(hero.name)}: ${hero.games} игр, ср. место ${fmtFloat(hero.avgPlace)}, винрейт ${fmtPercent(
        hero.games ? hero.wins / hero.games : 0,
      )}`;
      pool.append(chip);
    }
    card.append(pool);
  }

  // последние игры
  if (player.recent.length) {
    const recent = el('div', 'recent');
    for (const match of player.recent) {
      const dot = el('div', `place-dot place-${match.place || 0}`, String(match.place || '—'));
      dot.title = `${prettifyHero(match.heroName)} · ${match.place}-е место${
        match.ratingChange ? ` (${match.ratingChange > 0 ? '+' : ''}${match.ratingChange})` : ''
      }`;
      recent.append(dot);
    }
    card.append(recent);
  }

  return card;
}

function renderResult(result) {
  els.cards.replaceChildren();

  const players = result.players || [];
  const errors = result.errors || [];

  if (!players.length) {
    const empty = el('div', 'empty');
    empty.innerHTML = '';
    empty.append(el('div', null, 'Вставь SteamID64, account_id или ссылку на профиль.'));
    empty.append(el('div', null, 'Например: 76561198133050347 или steamcommunity.com/profiles/76561198133050347'));
    els.cards.append(empty);
  } else {
    for (const player of players) els.cards.append(renderCard(player));
  }

  if (errors.length) {
    setStatus(errors.map((e) => `${e.input ? e.input + ': ' : ''}${e.message}`).join(' · '), true);
  } else if (players.length) {
    setStatus(`Обновлено ${new Date().toLocaleTimeString('ru-RU')} · игроков: ${players.length}`);
  } else {
    setStatus('Нет данных', true);
  }

  els.cards.scrollTop = 0;
}

/* ---------- actions ---------- */

async function loadPlayers() {
  if (busy) return;
  const input = els.input.value.trim();

  if (!input) {
    setStatus('Вставь хотя бы один SteamID или ссылку', true);
    return;
  }

  localStorage.setItem(STORAGE_KEY, els.input.value);

  busy = true;
  els.load.disabled = true;
  setStatus('Загружаю с dota1x6.com…');

  try {
    const result = await window.overlay.load(input);
    if (!result.ok) {
      setStatus(result.errors?.[0]?.message || 'Ошибка загрузки', true);
      return;
    }
    renderResult(result);
  } catch (e) {
    setStatus(`Ошибка: ${e?.message || e}`, true);
  } finally {
    busy = false;
    els.load.disabled = false;
  }
}

async function togglePassthrough() {
  const state = await window.overlay.getState();
  await window.overlay.setPassthrough(state.interactive);
}

async function changeScale(factor) {
  const current = await window.overlay.getScale();
  const applied = await window.overlay.setScale(Math.round(current * factor * 100) / 100);
  setStatus(`Масштаб интерфейса: ${Math.round(applied * 100)}%`);
}

/* ---------- wiring ---------- */

els.load.addEventListener('click', loadPlayers);

els.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    loadPlayers();
  }
});

els.passthrough.addEventListener('click', togglePassthrough);
els.hide.addEventListener('click', () => window.overlay.hide());
els.close.addEventListener('click', () => window.overlay.close());

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

  if (event.key === '=' || event.key === '+') {
    event.preventDefault();
    changeScale(1.05);
  } else if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    changeScale(0.95);
  } else if (event.key === '0') {
    event.preventDefault();
    window.overlay.setScale(1.15).then((value) => setStatus(`Масштаб интерфейса: ${Math.round(value * 100)}%`));
  }
});

window.overlay.onState((state) => {
  document.body.classList.toggle('passthrough', !state.interactive);
  els.passthrough.classList.toggle('active', !state.interactive);
  els.passthrough.title = state.interactive ? 'Включить клик-сквозь (F9)' : 'Выключить клик-сквозь (F9)';
});

const saved = localStorage.getItem(STORAGE_KEY);
if (saved) {
  els.input.value = saved;
  loadPlayers();
} else {
  els.input.focus();
}
