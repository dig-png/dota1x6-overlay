'use strict';

// Служебная проверка: node scripts/eval.js "js expression"
async function main() {
  const expr = process.argv.slice(2).join(' ') || '1+1';
  const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = pages.find((p) => p.type === 'page');
  if (!page) throw new Error('no page');

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
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const out = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(out.result?.result?.value ?? out, null, 1));
  ws.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
