import assert from 'node:assert/strict';
import { getDb, closeDb } from '../server/db/database.js';
import tradingEngine from '../server/services/tradingEngine.js';
import executionRouter from '../server/services/executionRouter.js';
import webhookReceiver from '../server/services/webhookReceiver.js';
import binanceService from '../server/services/binance.js';

function resetState() {
  const db = getDb();
  db.prepare('DELETE FROM alerts').run();
  db.prepare('DELETE FROM trades').run();
  db.prepare('DELETE FROM orders').run();
  db.prepare('DELETE FROM positions').run();
  db.prepare("DELETE FROM wallets WHERE asset != 'USDT'").run();
  db.prepare("UPDATE wallets SET balance = 100000, locked = 0 WHERE type = 'spot' AND asset = 'USDT'").run();
  db.prepare("UPDATE wallets SET balance = 0, locked = 0 WHERE type = 'futures' AND asset = 'USDT'").run();
}

async function testFuturesPositionMerge() {
  resetState();
  binanceService.prices.clear();
  binanceService.prices.set('BTCUSDT', { price: 50000, timestamp: Date.now() });

  tradingEngine.transferBetweenWallets('spot', 'futures', 'USDT', 1000);
  await tradingEngine.placeOrder({
    symbol: 'BTCUSDT',
    side: 'buy',
    type: 'market',
    marketType: 'futures',
    quantity: 0.01,
    leverage: 5,
  });
  await tradingEngine.placeOrder({
    symbol: 'BTCUSDT',
    side: 'buy',
    type: 'market',
    marketType: 'futures',
    quantity: 0.01,
    leverage: 5,
  });

  const positions = tradingEngine.getOpenPositions();
  assert.equal(positions.length, 1, 'expected one merged futures position');
  assert.equal(positions[0].quantity, 0.02, 'expected merged position quantity to be 0.02');
}

async function testWebhookRespectsLiveMode() {
  resetState();
  binanceService.prices.clear();
  binanceService.prices.set('SOLUSDT', { price: 150, timestamp: Date.now() });

  const previousMode = process.env.TRADING_MODE;
  process.env.TRADING_MODE = 'live';

  const before = getDb().prepare('SELECT COUNT(*) AS count FROM orders').get().count;
  const result = await webhookReceiver.processAlert({
    secret: 'change_this_to_a_secure_random_string',
    action: 'buy',
    symbol: 'SOLUSDT',
    type: 'spot',
    orderType: 'market',
    quantity: 1,
  });
  const after = getDb().prepare('SELECT COUNT(*) AS count FROM orders').get().count;

  if (previousMode === undefined) delete process.env.TRADING_MODE;
  else process.env.TRADING_MODE = previousMode;

  assert.equal(result.success, false, 'expected webhook order to fail in live mode');
  assert.match(result.error, /Live trading not yet implemented/, 'expected live-mode safety error');
  assert.equal(after, before, 'expected no new order to be created in live mode');
  assert.equal(executionRouter.getMode(), previousMode || 'paper');
}

function testGetOpenOrdersIgnoresInjectedFilter() {
  resetState();
  const orders = tradingEngine.getOpenOrders("spot' OR 1=1 --");
  assert.deepEqual(orders, [], 'expected injected marketType filter to return no rows');
}

async function main() {
  console.log('[Smoke] Running trading backend smoke checks');
  await testFuturesPositionMerge();
  console.log('[Smoke] Futures merge path passed');
  await testWebhookRespectsLiveMode();
  console.log('[Smoke] Webhook live-mode guard passed');
  testGetOpenOrdersIgnoresInjectedFilter();
  console.log('[Smoke] Open-order filter parameterization passed');
  console.log('[Smoke] All checks passed');
}

main()
  .catch((err) => {
    console.error('[Smoke] Failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
