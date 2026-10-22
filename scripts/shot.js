'use strict';

// Служебный скрипт для проверки UI через CDP: node scripts/shot.js [ids]
const fs = require('fs');

const IDS = process.argv[2] || '172784619\\n76561198076808958';

async function main() {
  let pages = [];
  for (let i = 0; i < 40; i += 1) {
    try {
      pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
      if (pages.some((p) => p.type === 'page')) break;
    } catch {
      /* приложение ещё стартует */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const page = pages.find((p) => p.type === 'page');
  if (!page) throw new Error('CDP page not found');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.evaluate', {
    expression: `document.getElementById('ids').value='${IDS}'; document.getElementById('btn-load').click();`,
  });

  await new Promise((r) => setTimeout(r, 7000));

  const dom = await send('Runtime.evaluate', {
    expression:
      "({cards:document.querySelectorAll('.card').length, status:document.getElementById('status').textContent, err:document.getElementById('status').className})",
    returnByValue: true,
  });
  console.log(JSON.stringify(dom.result?.result?.value, null, 1));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('shot.png', Buffer.from(shot.result.data, 'base64'));
  console.log('saved shot.png');

  ws.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
