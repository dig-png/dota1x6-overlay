'use strict';

// Данные берутся из публичного API сайта dota1x6.com (без ключей и авторизации).
const API_BASE = 'https://stats.dota1x6.com/api/v2';
const SITE_BASE = 'https://dota1x6.com';

const STEAM64_BASE = 76561197960265728n;
const MAX_ACCOUNT_ID = 4294967294;
const REQUEST_TIMEOUT_MS = 12000;
const HERO_POOL_PAGES = 2; // 2 страницы по 25 матчей = последние 50 игр
const PAGE_SIZE = 25;

class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function request(url, { json = true } = {}) {
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: json ? 'application/json' : 'text/xml,text/plain,*/*' },
    });
  } catch (e) {
    throw new ApiError('Сайт dota1x6 недоступен', 'NETWORK');
  }

  const text = await res.text();
  if (!json) {
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, 'HTTP');
    return text;
  }

  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // сервер иногда отдаёт не-JSON на ошибках
  }

  if (!res.ok || (body && body.hasErrors)) {
    const msg = body?.errors?.[0]?.text || `HTTP ${res.status}`;
    const code = /not found/i.test(msg) ? 'NOT_FOUND' : 'API';
    throw new ApiError(msg, code);
  }

  return body;
}

function toAccountId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= MAX_ACCOUNT_ID ? id : null;
}

function accountIdFromSteam64(steam64) {
  try {
    return toAccountId(BigInt(steam64) - STEAM64_BASE);
  } catch {
    return null;
  }
}

function accountIdFromSteam2(match) {
  const [, y, z] = match;
  return toAccountId(Number(z) * 2 + Number(y));
}

/**
 * Разбирает ввод пользователя на отдельные записи.
 * Поддерживаются: account_id, SteamID64, STEAM_0:x:y, [U:1:x],
 * ссылки /profiles/<64> и /id/<vanity>.
 */
function parseEntries(raw) {
  const tokens = String(raw || '')
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const entries = [];
  const seen = new Set();

  for (const token of tokens) {
    let entry = null;

    let m = token.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
    if (m) {
      const id = accountIdFromSteam64(m[1]);
      entry = id ? { kind: 'account', accountId: id } : { kind: 'error', input: token, message: 'Некорректный SteamID64' };
    }

    if (!entry) {
      m = token.match(/steamcommunity\.com\/id\/([A-Za-z0-9_.-]+)/i);
      if (m) entry = { kind: 'vanity', vanity: m[1], input: token };
    }

    if (!entry) {
      m = token.match(/^STEAM_[0-5]:([01]):(\d+)$/i);
      if (m) {
        const id = accountIdFromSteam2(m);
        entry = id ? { kind: 'account', accountId: id } : { kind: 'error', input: token, message: 'Некорректный STEAM_0' };
      }
    }

    if (!entry) {
      m = token.match(/^\[U:1:(\d+)\]$/i);
      if (m) {
        const id = toAccountId(m[1]);
        entry = id ? { kind: 'account', accountId: id } : { kind: 'error', input: token, message: 'Некорректный [U:1:]' };
      }
    }

    if (!entry) {
      m = token.match(/^\d{17}$/);
      if (m) {
        const id = accountIdFromSteam64(token);
        entry = id ? { kind: 'account', accountId: id } : { kind: 'error', input: token, message: 'Некорректный SteamID64' };
      }
    }

    if (!entry) {
      m = token.match(/^\d{1,10}$/);
      if (m) {
        const id = toAccountId(token);
        entry = id
          ? { kind: 'account', accountId: id }
          : { kind: 'error', input: token, message: 'Некорректный account_id' };
      }
    }

    if (!entry) {
      entry = {
        kind: 'error',
        input: token,
        message: 'Нужен SteamID64, account_id или ссылка на профиль Steam',
      };
    }

    if (entry.kind === 'account') {
      if (seen.has(entry.accountId)) continue;
      seen.add(entry.accountId);
    }

    entries.push(entry);
  }

  return entries;
}

async function resolveVanity(vanity) {
  let xml;
  try {
    xml = await request(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`, { json: false });
  } catch (e) {
    throw new ApiError('Не удалось открыть профиль Steam', 'STEAM');
  }
  const m = xml.match(/<steamID64>(\d+)<\/steamID64>/);
  if (!m) throw new ApiError('Профиль Steam не найден', 'STEAM');
  const id = accountIdFromSteam64(m[1]);
  if (!id) throw new ApiError('Некорректный SteamID64 в профиле', 'STEAM');
  return id;
}

async function loadLeaderboard() {
  try {
    const body = await request(`${API_BASE}/leaderboard`);
    const map = new Map();
    for (const row of body?.data || []) {
      if (row && row.playerId != null) map.set(Number(row.playerId), row.place);
    }
    return map;
  } catch {
    return null; // ладдер не критичен
  }
}

function heroNameToFile(heroName) {
  return String(heroName || '').replace(/^npc_dota_hero_/, '');
}

/** Агрегирует пул героев по последним матчам. */
function buildHeroPool(matches) {
  const map = new Map();

  for (const match of matches) {
    if (!match?.heroName) continue;
    const entry = map.get(match.heroName) || {
      name: match.heroName,
      file: heroNameToFile(match.heroName),
      games: 0,
      wins: 0,
      placeSum: 0,
      lastPlayed: null,
    };
    entry.games += 1;
    if (match.place === 1) entry.wins += 1;
    if (match.place) entry.placeSum += match.place;
    if (!entry.lastPlayed && match.createdAtUtc) entry.lastPlayed = match.createdAtUtc;
    map.set(match.heroName, entry);
  }

  return [...map.values()]
    .map((e) => ({ ...e, avgPlace: e.games ? e.placeSum / e.games : 0 }))
    .sort((a, b) => b.games - a.games || a.avgPlace - b.avgPlace || a.name.localeCompare(b.name))
    .slice(0, 6);
}

async function fetchMatches(accountId) {
  const pages = [];
  for (let page = 1; page <= HERO_POOL_PAGES; page += 1) {
    pages.push(`${API_BASE}/matches/history?playerId=${accountId}&page=${page}&count=${PAGE_SIZE}`);
  }

  const results = await Promise.allSettled(pages.map((url) => request(url)));
  const matches = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      matches.push(...(result.value?.data?.values || []));
    }
  }
  return matches;
}

async function loadPlayer(accountId, leaderboard) {
  const [playerResult, steamResult, matches] = await Promise.all([
    request(`${API_BASE}/players?playerId=${accountId}`),
    request(`${API_BASE}/players/steam-profile?playerId=${accountId}`).catch(() => null),
    fetchMatches(accountId).catch(() => []),
  ]);

  const player = playerResult?.data || {};
  const steam = steamResult?.data || {};
  const matchCount = Number(player.matchCount) || 0;
  const firstPlaces = Number(player.firstPlaces) || 0;
  const firstRate = matchCount ? firstPlaces / matchCount : 0;
  const places = player.places || null;

  // В API массив places нормирован к количеству первых мест,
  // поэтому доля места = places[k] * (firstPlaces / matchCount).
  const placeShare = (place) => (places && places[place] != null ? Number(places[place]) * firstRate : 0);
  const top3Rate = Math.min(1, placeShare('1') + placeShare('2') + placeShare('3'));

  return {
    accountId,
    name: steam.personaname || `#${accountId}`,
    avatar: steam.avatarfull || null,
    profileUrl: `${SITE_BASE}/players/${accountId}`,
    steamUrl: steam.profileurl || `https://steamcommunity.com/profiles/${BigInt(accountId) + STEAM64_BASE}`,
    rating: Number(player.rating) || 0,
    duoRating: Number(player.duoRating) || 0,
    matchCount,
    avgPlace: Number(player.avgPlace) || 0,
    firstPlaces,
    firstRate,
    top3Rate,
    favoriteHero: player.favoriteHero || null,
    favoriteHeroFile: heroNameToFile(player.favoriteHero),
    places,
    leaderboardPlace: leaderboard ? leaderboard.get(accountId) ?? null : null,
    heroes: buildHeroPool(matches),
    recent: matches.slice(0, 6).map((m) => ({
      heroName: m.heroName,
      heroFile: heroNameToFile(m.heroName),
      place: m.place,
      ratingChange: m.ratingChange,
      mapName: m.mapName,
    })),
    sampledMatches: matches.length,
  };
}

/**
 * Основная точка входа: принимает сырой ввод, возвращает карточки игроков.
 * @returns {Promise<{players: object[], errors: {input: string, message: string}[]}>}
 */
async function loadPlayers(rawInput) {
  const entries = parseEntries(rawInput);
  if (!entries.length) {
    return { players: [], errors: [{ input: '', message: 'Вставь хотя бы один SteamID или ссылку' }] };
  }

  const errors = [];
  const accountIds = [];
  const addAccountId = (id) => {
    if (id && !accountIds.includes(id)) accountIds.push(id);
  };

  await Promise.all(
    entries.map(async (entry) => {
      if (entry.kind === 'error') {
        errors.push({ input: entry.input, message: entry.message });
        return;
      }
      if (entry.kind === 'account') {
        addAccountId(entry.accountId);
        return;
      }
      try {
        addAccountId(await resolveVanity(entry.vanity));
      } catch (e) {
        errors.push({ input: entry.input, message: e.message });
      }
    }),
  );

  const leaderboard = accountIds.length ? await loadLeaderboard() : null;

  const players = await Promise.all(
    accountIds.map(async (accountId) => {
      try {
        return await loadPlayer(accountId, leaderboard);
      } catch (e) {
        const message = e.code === 'NOT_FOUND' ? 'Игрок не найден на dota1x6' : e.message;
        errors.push({ input: String(accountId), message });
        return null;
      }
    }),
  );

  return {
    players: players.filter(Boolean).sort((a, b) => b.rating - a.rating),
    errors,
  };
}

module.exports = {
  API_BASE,
  parseEntries,
  loadPlayers,
  loadLeaderboard,
  buildHeroPool,
  heroNameToFile,
  accountIdFromSteam64,
};
