'use strict';

// Быстрая проверка слоя данных без запуска Electron: npm run test:api

const { parseEntries, loadPlayers } = require('../lib/api');

async function main() {
  console.log('--- parseEntries ---');
  const parsed = parseEntries(
    [
      '76561198133050347',
      '172784619',
      'https://steamcommunity.com/profiles/76561198133050347',
      'https://steamcommunity.com/id/dendi',
      'STEAM_0:1:66525159',
      '[U:1:133050319]',
      'какой-то-мусор',
    ].join('\n'),
  );
  console.log(parsed);

  console.log('\n--- loadPlayers ---');
  const result = await loadPlayers('172784619\n76561198133050347\n1');
  console.log('errors:', result.errors);
  for (const p of result.players) {
    console.log(
      `${p.name} (${p.accountId}) rating=${p.rating} place=${p.leaderboardPlace} ` +
        `matches=${p.matchCount} avgPlace=${p.avgPlace.toFixed(2)} first=${(p.firstRate * 100).toFixed(0)}%`,
    );
    console.log(
      '  heroes:',
      p.heroes.map((h) => `${h.file} x${h.games} (avg ${h.avgPlace.toFixed(2)})`).join(', '),
    );
    console.log('  recent:', p.recent.map((r) => `${r.heroFile}:${r.place}`).join(' '));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
