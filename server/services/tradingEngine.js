import { getDb } from '../db/database.js';
import { v4 as uuidv4 } from 'uuid';
import binanceService from './binance.js';
import binanceExecutionService from './binanceExecution.js';

class TradingEngine {
  constructor() {
    this.pendingOrders = [];
    this.checkInterval = null;
  }

  getConfig(key) {
    const db = getDb();
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  // --- Wallet Management ---
  getWallet(type, asset) {
    const db = getDb();
    let wallet = db.prepare('SELECT * FROM wallets WHERE type = ? AND asset = ?').get(type, asset);
    if (!wallet) {
      db.prepare('INSERT INTO wallets (type, asset, balance) VALUES (?, ?, 0)').run(type, asset);
      wallet = db.prepare('SELECT * FROM wallets WHERE type = ? AND asset = ?').get(type, asset);
    }
    return wallet;
  }

  getBalance(type, asset) {
    const wallet = this.getWallet(type, asset);
    return wallet.balance - wallet.locked;
  }

  getAllWallets(type) {
    const db = getDb();
    return db.prepare('SELECT * FROM wallets WHERE type = ? AND balance > 0').all(type);
  }

  updateBalance(type, asset, delta) {
    const db = getDb();
    this.getWallet(type, asset); // ensure exists
    db.prepare(
      'UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE type = ? AND asset = ?'
    ).run(delta, type, asset);
  }

  lockBalance(type, asset, amount) {
    const db = getDb();
    db.prepare(
      'UPDATE wallets SET locked = locked + ?, updated_at = CURRENT_TIMESTAMP WHERE type = ? AND asset = ?'
    ).run(amount, type, asset);
  }

  unlockBalance(type, asset, amount) {
    const db = getDb();
    db.prepare(
      'UPDATE wallets SET locked = MAX(0, locked - ?), updated_at = CURRENT_TIMESTAMP WHERE type = ? AND asset = ?'
    ).run(amount, type, asset);
  }

  transferBetweenWallets(fromType, toType, asset, amount) {
    const db = getDb();
    const available = this.getBalance(fromType, asset);
    if (available < amount) {
      throw new Error(`Insufficient ${asset} in ${fromType} wallet. Available: ${available}`);
    }

    const transfer = db.transaction(() => {
      this.updateBalance(fromType, asset, -amount);
      this.updateBalance(toType, asset, amount);
    });
    transfer();

    return { fromType, toType, asset, amount };
  }

  // --- Portfolio ---
  async getPortfolio() {
    await this.syncLiveFuturesPositions();
    const db = getDb();
    const spotWallets = db.prepare("SELECT * FROM wallets WHERE type = 'spot'").all();
    const futuresWallets = db.prepare("SELECT * FROM wallets WHERE type = 'futures'").all();
    const openPositions = db.prepare("SELECT * FROM positions WHERE status = 'open'").all();

    let totalSpotValue = 0;
    const holdings = [];

    for (const w of spotWallets) {
      if (w.balance <= 0) continue;
      let value = w.balance;
      let price = 1;
      if (w.asset !== 'USDT') {
        price = binanceService.getCachedPrice(`${w.asset}USDT`) || 0;
        value = w.balance * price;
      }
      totalSpotValue += value;
      holdings.push({
        asset: w.asset,
        balance: w.balance,
        locked: w.locked,
        available: w.balance - w.locked,
        price,
        value,
      });
    }

    let totalFuturesValue = 0;
    const futuresUSDT = futuresWallets.find(w => w.asset === 'USDT');
    if (futuresUSDT) totalFuturesValue = futuresUSDT.balance;

    let unrealizedPnl = 0;
    for (const pos of openPositions) {
      const markPrice = binanceService.getCachedPrice(pos.symbol) || pos.entry_price;
      const pnl = pos.side === 'long'
        ? (markPrice - pos.entry_price) * pos.quantity
        : (pos.entry_price - markPrice) * pos.quantity;
      unrealizedPnl += pnl;
    }
    totalFuturesValue += unrealizedPnl;

    const totalValue = totalSpotValue + totalFuturesValue;
    const startingBalance = parseFloat(this.getConfig('starting_balance') || '100000');
    const totalPnl = totalValue - startingBalance;
    const totalPnlPct = (totalPnl / startingBalance) * 100;

    return {
      totalValue,
      totalPnl,
      totalPnlPct,
      spotValue: totalSpotValue,
      futuresValue: totalFuturesValue,
      unrealizedPnl,
      holdings,
      openPositions: openPositions.length,
    };
  }

  shouldSyncLiveFutures() {
    return process.env.TRADING_MODE === 'live'
      && process.env.BINANCE_EXECUTION_ENV === 'live'
      && process.env.BINANCE_FUTURES_LIVE_ENABLED === 'true'
      && binanceExecutionService.isConfigured();
  }

  async syncLiveFuturesPositions() {
    if (!this.shouldSyncLiveFutures()) return [];

    const db = getDb();
    const positionRisk = await binanceExecutionService.getFuturesPositionRisk();
    const openRemote = positionRisk.filter((row) => Number(row.positionAmt) !== 0);
    const seenKeys = new Set();

    for (const remote of openRemote) {
      const quantity = Math.abs(Number(remote.positionAmt));
      const side = Number(remote.positionAmt) > 0 ? 'long' : 'short';
      const key = `${remote.symbol}:${side}`;
      seenKeys.add(key);

      const isolatedWallet = Number(remote.isolatedWallet || 0);
      const notional = Math.abs(Number(remote.notional || 0));
      const leverage = Number(remote.leverage || 1);
      const derivedMargin = isolatedWallet > 0 ? isolatedWallet : (leverage > 0 ? notional / leverage : 0);
      const entryPrice = Number(remote.entryPrice || 0);
      const liquidationPrice = Number(remote.liquidationPrice || 0);
      const unrealizedPnl = Number(remote.unRealizedProfit || 0);
      const marginType = String(remote.marginType || 'isolated').toLowerCase() === 'cross' ? 'cross' : 'isolated';

      const existing = db.prepare(`
        SELECT * FROM positions
        WHERE symbol = ? AND side = ? AND status = 'open'
        ORDER BY id DESC
        LIMIT 1
      `).get(remote.symbol, side);

      if (existing) {
        db.prepare(`
          UPDATE positions
          SET entry_price = ?, quantity = ?, leverage = ?, margin = ?, liquidation_price = ?,
              unrealized_pnl = ?, margin_type = ?
          WHERE id = ?
        `).run(
          entryPrice,
          quantity,
          leverage,
          derivedMargin,
          liquidationPrice || null,
          unrealizedPnl,
          marginType,
          existing.id
        );
      } else {
        db.prepare(`
          INSERT INTO positions
          (symbol, side, entry_price, quantity, leverage, margin, liquidation_price, unrealized_pnl, realized_pnl, status, margin_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'open', ?)
        `).run(
          remote.symbol,
          side,
          entryPrice,
          quantity,
          leverage,
          derivedMargin,
          liquidationPrice || null,
          unrealizedPnl,
          marginType
        );
      }
    }

    const localOpen = db.prepare(`SELECT * FROM positions WHERE status = 'open'`).all();
    for (const pos of localOpen) {
      const key = `${pos.symbol}:${pos.side}`;
      if (!seenKeys.has(key)) {
        db.prepare(`
          UPDATE positions
          SET status = 'closed', closed_at = CURRENT_TIMESTAMP, unrealized_pnl = 0
          WHERE id = ?
        `).run(pos.id);
      }
    }

    return openRemote;
  }

  // --- Order Management ---
  async placeOrder(params) {
    const {
      symbol, side, type, marketType = 'spot', price, stopPrice,
      quantity, quantityPercent, leverage = 1, takeProfit, stopLoss,
      source = 'manual',
    } = params;

    // Calculate quantity from percentage if needed
    let orderQty = quantity;
    if (!orderQty && quantityPercent) {
      const usdtBalance = this.getBalance(marketType, 'USDT');
      const currentPrice = binanceService.getCachedPrice(symbol) || price;
      if (!currentPrice) throw new Error('Cannot determine current price');
      const usdtAmount = usdtBalance * (quantityPercent / 100);
      orderQty = usdtAmount / currentPrice;
    }

    if (!orderQty || orderQty <= 0) {
      throw new Error('Invalid quantity');
    }

    const db = getDb();
    const clientOrderId = uuidv4();

    // Validate balance
    if (marketType === 'spot') {
      if (side === 'buy') {
        const currentPrice = binanceService.getCachedPrice(symbol) || price;
        const cost = orderQty * currentPrice;
        const available = this.getBalance('spot', 'USDT');
        if (cost > available) {
          throw new Error(`Insufficient USDT. Need ${cost.toFixed(2)}, have ${available.toFixed(2)}`);
        }
      } else {
        const baseAsset = symbol.replace('USDT', '');
        const available = this.getBalance('spot', baseAsset);
        if (orderQty > available) {
          throw new Error(`Insufficient ${baseAsset}. Need ${orderQty}, have ${available}`);
        }
      }
    } else if (marketType === 'futures') {
      const currentPrice = binanceService.getCachedPrice(symbol) || price;
      const margin = (orderQty * currentPrice) / leverage;
      const available = this.getBalance('futures', 'USDT');
      if (margin > available) {
        throw new Error(`Insufficient margin. Need ${margin.toFixed(2)} USDT, have ${available.toFixed(2)} USDT`);
      }
    }

    // Insert order
    const result = db.prepare(`
      INSERT INTO orders (client_order_id, symbol, side, type, market_type, price, stop_price, quantity, leverage, take_profit, stop_loss, source, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(clientOrderId, symbol, side, type, marketType, price || null, stopPrice || null, orderQty, leverage, takeProfit || null, stopLoss || null, source);

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);

    // Execute immediately for market orders
    if (type === 'market') {
      return this._executeMarketOrder(order);
    }

    // Lock balance for limit orders
    this._lockOrderBalance(order);

    return order;
  }

  async _executeMarketOrder(order) {
    const db = getDb();
    const currentPrice = binanceService.getCachedPrice(order.symbol);
    if (!currentPrice) {
      throw new Error(`No price data for ${order.symbol}`);
    }

    // Apply slippage
    const slippage = parseFloat(this.getConfig('slippage') || '0.0005');
    const fillPrice = order.side === 'buy'
      ? currentPrice * (1 + slippage)
      : currentPrice * (1 - slippage);

    // Calculate fee
    const feeRate = parseFloat(this.getConfig('taker_fee') || '0.001');
    const fee = order.quantity * fillPrice * feeRate;

    if (order.market_type === 'spot') {
      this._executeSpotFill(order, fillPrice, order.quantity, fee);
    } else {
      this._executeFuturesFill(order, fillPrice, order.quantity, fee);
    }

    // Update order status
    db.prepare(`
      UPDATE orders SET status = 'filled', filled_quantity = quantity, fee = ?, price = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(fee, fillPrice, order.id);

    // Record trade
    db.prepare(`
      INSERT INTO trades (order_id, symbol, side, price, quantity, fee, market_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(order.id, order.symbol, order.side, fillPrice, order.quantity, fee, order.market_type);

    // Handle TP/SL
    if (order.take_profit || order.stop_loss) {
      this._createConditionalOrders(order, fillPrice);
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    return updated;
  }

  _executeSpotFill(order, price, quantity, fee) {
    const baseAsset = order.symbol.replace('USDT', '');

    if (order.side === 'buy') {
      const cost = quantity * price + fee;
      this.updateBalance('spot', 'USDT', -cost);
      this.updateBalance('spot', baseAsset, quantity);
    } else {
      const proceeds = quantity * price - fee;
      this.updateBalance('spot', baseAsset, -quantity);
      this.updateBalance('spot', 'USDT', proceeds);
    }
  }

  _executeFuturesFill(order, price, quantity, fee) {
    const db = getDb();

    // Deduct fee
    this.updateBalance('futures', 'USDT', -fee);

    // Check for existing position
    const existing = db.prepare(
      "SELECT * FROM positions WHERE symbol = ? AND status = 'open' AND side = ?"
    ).get(order.symbol, order.side === 'buy' ? 'long' : 'short');

    if (existing) {
      // Add to existing position
      const totalQty = existing.quantity + quantity;
      const avgPrice = (existing.entry_price * existing.quantity + price * quantity) / totalQty;
      const additionalMargin = (quantity * price) / order.leverage;

      db.prepare(`
        UPDATE positions SET quantity = ?, entry_price = ?, margin = margin + ?,
        liquidation_price = ? WHERE id = ?
      `).run(
        totalQty, avgPrice, additionalMargin,
        this._calcLiquidationPrice(order.side === 'buy' ? 'long' : 'short', avgPrice, order.leverage),
        existing.id
      );

      this.lockBalance('futures', 'USDT', additionalMargin);
    } else {
      // Check if closing opposite position
      const opposite = db.prepare(
        "SELECT * FROM positions WHERE symbol = ? AND status = 'open' AND side = ?"
      ).get(order.symbol, order.side === 'buy' ? 'short' : 'long');

      if (opposite) {
        return this._closePosition(opposite.id, price, Math.min(quantity, opposite.quantity));
      }

      // New position
      const margin = (quantity * price) / order.leverage;
      const side = order.side === 'buy' ? 'long' : 'short';
      const liqPrice = this._calcLiquidationPrice(side, price, order.leverage);

      db.prepare(`
        INSERT INTO positions (symbol, side, entry_price, quantity, leverage, margin, liquidation_price, margin_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'isolated')
      `).run(order.symbol, side, price, quantity, order.leverage, margin, liqPrice);

      this.lockBalance('futures', 'USDT', margin);
    }
  }

  _calcLiquidationPrice(side, entryPrice, leverage) {
    const maintenanceMarginRate = 0.004; // 0.4% for most positions
    if (side === 'long') {
      return entryPrice * (1 - (1 / leverage) + maintenanceMarginRate);
    } else {
      return entryPrice * (1 + (1 / leverage) - maintenanceMarginRate);
    }
  }

  _lockOrderBalance(order) {
    if (order.market_type === 'spot') {
      if (order.side === 'buy') {
        const cost = order.quantity * (order.price || 0);
        this.lockBalance('spot', 'USDT', cost);
      } else {
        const baseAsset = order.symbol.replace('USDT', '');
        this.lockBalance('spot', baseAsset, order.quantity);
      }
    } else {
      const cost = (order.quantity * (order.price || 0)) / order.leverage;
      this.lockBalance('futures', 'USDT', cost);
    }
  }

  _createConditionalOrders(parentOrder, fillPrice) {
    if (parentOrder.take_profit) {
      const tpSide = parentOrder.side === 'buy' ? 'sell' : 'buy';
      this.placeOrder({
        symbol: parentOrder.symbol,
        side: tpSide,
        type: 'take_profit',
        marketType: parentOrder.market_type,
        stopPrice: parentOrder.take_profit,
        quantity: parentOrder.quantity,
        leverage: parentOrder.leverage,
        source: parentOrder.source,
      });
    }
    if (parentOrder.stop_loss) {
      const slSide = parentOrder.side === 'buy' ? 'sell' : 'buy';
      this.placeOrder({
        symbol: parentOrder.symbol,
        side: slSide,
        type: 'stop_market',
        marketType: parentOrder.market_type,
        stopPrice: parentOrder.stop_loss,
        quantity: parentOrder.quantity,
        leverage: parentOrder.leverage,
        source: parentOrder.source,
      });
    }
  }

  // --- Position Management ---
  _closePosition(positionId, price, quantity) {
    const db = getDb();
    const pos = db.prepare('SELECT * FROM positions WHERE id = ?').get(positionId);
    if (!pos || pos.status !== 'open') throw new Error('Position not found or already closed');

    const closeQty = quantity || pos.quantity;
    const pnl = pos.side === 'long'
      ? (price - pos.entry_price) * closeQty
      : (pos.entry_price - price) * closeQty;

    const feeRate = parseFloat(this.getConfig('taker_fee') || '0.001');
    const fee = closeQty * price * feeRate;
    const netPnl = pnl - fee;

    const marginRelease = (closeQty / pos.quantity) * pos.margin;

    if (closeQty >= pos.quantity) {
      // Full close
      db.prepare(`
        UPDATE positions SET status = 'closed', realized_pnl = ?, closed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(netPnl, positionId);
    } else {
      // Partial close
      db.prepare(`
        UPDATE positions SET quantity = quantity - ?, margin = margin - ?, realized_pnl = realized_pnl + ?
        WHERE id = ?
      `).run(closeQty, marginRelease, netPnl, positionId);
    }

    // Release margin + PnL
    this.unlockBalance('futures', 'USDT', marginRelease);
    this.updateBalance('futures', 'USDT', netPnl);

    // Record trade
    db.prepare(`
      INSERT INTO trades (symbol, side, price, quantity, fee, realized_pnl, market_type)
      VALUES (?, ?, ?, ?, ?, ?, 'futures')
    `).run(pos.symbol, pos.side === 'long' ? 'sell' : 'buy', price, closeQty, fee, netPnl);

    return { positionId, pnl: netPnl, fee, price, quantity: closeQty };
  }

  async closePosition(positionId, price) {
    await this.syncLiveFuturesPositions();
    const currentPrice = price || binanceService.getCachedPrice(
      getDb().prepare('SELECT symbol FROM positions WHERE id = ?').get(positionId)?.symbol
    );
    if (!currentPrice) throw new Error('Cannot determine current price');
    return this._closePosition(positionId, currentPrice);
  }

  // --- Order Book / Limit Fill Checking ---
  startOrderMonitor() {
    this.checkInterval = setInterval(() => this._checkPendingOrders(), 1000);
    console.log('[TradingEngine] Order monitor started');
  }

  stopOrderMonitor() {
    if (this.checkInterval) clearInterval(this.checkInterval);
  }

  _checkPendingOrders() {
    const db = getDb();
    const pending = db.prepare(
      "SELECT * FROM orders WHERE status IN ('pending', 'partial') AND type != 'market'"
    ).all();

    for (const order of pending) {
      const price = binanceService.getCachedPrice(order.symbol);
      if (!price) continue;

      let shouldFill = false;

      switch (order.type) {
        case 'limit':
          if (order.side === 'buy' && price <= order.price) shouldFill = true;
          if (order.side === 'sell' && price >= order.price) shouldFill = true;
          break;
        case 'stop_market':
        case 'stop_limit':
          if (order.side === 'buy' && price >= order.stop_price) shouldFill = true;
          if (order.side === 'sell' && price <= order.stop_price) shouldFill = true;
          break;
        case 'take_profit':
        case 'take_profit_limit':
          if (order.side === 'sell' && price >= order.stop_price) shouldFill = true;
          if (order.side === 'buy' && price <= order.stop_price) shouldFill = true;
          break;
      }

      if (shouldFill) {
        try {
          this._unlockAndExecute(order, price);
        } catch (err) {
          console.error(`[TradingEngine] Fill error for order ${order.id}:`, err.message);
        }
      }
    }

    // Check liquidations
    this._checkLiquidations();
  }

  _unlockAndExecute(order, price) {
    // Unlock previously locked balance
    if (order.market_type === 'spot') {
      if (order.side === 'buy') {
        this.unlockBalance('spot', 'USDT', order.quantity * (order.price || price));
      } else {
        const baseAsset = order.symbol.replace('USDT', '');
        this.unlockBalance('spot', baseAsset, order.quantity);
      }
    } else {
      this.unlockBalance('futures', 'USDT', (order.quantity * (order.price || price)) / order.leverage);
    }

    const fillPrice = order.price || price;
    const feeRate = parseFloat(this.getConfig('maker_fee') || '0.001');
    const fee = order.quantity * fillPrice * feeRate;

    if (order.market_type === 'spot') {
      this._executeSpotFill(order, fillPrice, order.quantity, fee);
    } else {
      this._executeFuturesFill(order, fillPrice, order.quantity, fee);
    }

    const db = getDb();
    db.prepare(`
      UPDATE orders SET status = 'filled', filled_quantity = quantity, fee = ?, price = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(fee, fillPrice, order.id);

    db.prepare(`
      INSERT INTO trades (order_id, symbol, side, price, quantity, fee, market_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(order.id, order.symbol, order.side, fillPrice, order.quantity, fee, order.market_type);

    // Cancel related OCO orders
    this._cancelRelatedOrders(order);

    console.log(`[TradingEngine] Order ${order.id} filled at ${fillPrice}`);
  }

  _cancelRelatedOrders(filledOrder) {
    // When a TP fills, cancel the SL and vice versa
    const db = getDb();
    if (filledOrder.type === 'take_profit' || filledOrder.type === 'stop_market') {
      const related = db.prepare(`
        SELECT * FROM orders WHERE symbol = ? AND status = 'pending'
        AND type IN ('take_profit', 'stop_market') AND id != ?
        AND quantity = ? AND market_type = ?
      `).all(filledOrder.symbol, filledOrder.id, filledOrder.quantity, filledOrder.market_type);

      for (const r of related) {
        this.cancelOrder(r.id);
      }
    }
  }

  _checkLiquidations() {
    const db = getDb();
    const positions = db.prepare("SELECT * FROM positions WHERE status = 'open'").all();

    for (const pos of positions) {
      const price = binanceService.getCachedPrice(pos.symbol);
      if (!price || !pos.liquidation_price) continue;

      const isLiquidated = pos.side === 'long'
        ? price <= pos.liquidation_price
        : price >= pos.liquidation_price;

      if (isLiquidated) {
        console.log(`[TradingEngine] LIQUIDATION: Position ${pos.id} ${pos.symbol} ${pos.side}`);
        db.prepare(`
          UPDATE positions SET status = 'liquidated', realized_pnl = ?, closed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(-pos.margin, pos.id);

        // Lose the margin
        this.unlockBalance('futures', 'USDT', pos.margin);
        this.updateBalance('futures', 'USDT', -pos.margin);

        db.prepare(`
          INSERT INTO trades (symbol, side, price, quantity, fee, realized_pnl, market_type)
          VALUES (?, ?, ?, ?, 0, ?, 'futures')
        `).run(pos.symbol, pos.side === 'long' ? 'sell' : 'buy', pos.liquidation_price, pos.quantity, -pos.margin);

        db.prepare(`
          INSERT INTO audit_log (event, details) VALUES ('liquidation', ?)
        `).run(JSON.stringify({ positionId: pos.id, symbol: pos.symbol, side: pos.side, liqPrice: pos.liquidation_price }));
      }
    }
  }

  cancelOrder(orderId) {
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw new Error('Order not found');
    if (order.status !== 'pending' && order.status !== 'partial') {
      throw new Error('Order cannot be cancelled');
    }

    // Unlock balance
    if (order.market_type === 'spot') {
      if (order.side === 'buy') {
        this.unlockBalance('spot', 'USDT', order.quantity * (order.price || 0));
      } else {
        const baseAsset = order.symbol.replace('USDT', '');
        this.unlockBalance('spot', baseAsset, order.quantity - order.filled_quantity);
      }
    } else {
      this.unlockBalance('futures', 'USDT', ((order.quantity - order.filled_quantity) * (order.price || 0)) / order.leverage);
    }

    db.prepare(
      "UPDATE orders SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(orderId);

    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  }

  // --- Queries ---
  getOpenOrders(marketType) {
    const db = getDb();
    let query = "SELECT * FROM orders WHERE status IN ('pending', 'partial')";
    const params = [];
    if (marketType) {
      query += ' AND market_type = ?';
      params.push(marketType);
    }
    query += ' ORDER BY created_at DESC';
    return db.prepare(query).all(...params);
  }

  getOrderHistory(limit = 100, offset = 0) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(limit, offset);
  }

  async getOpenPositions() {
    await this.syncLiveFuturesPositions();
    const db = getDb();
    const positions = db.prepare("SELECT * FROM positions WHERE status = 'open'").all();

    return positions.map(pos => {
      const markPrice = binanceService.getCachedPrice(pos.symbol) || pos.entry_price;
      const unrealizedPnl = pos.side === 'long'
        ? (markPrice - pos.entry_price) * pos.quantity
        : (pos.entry_price - markPrice) * pos.quantity;
      const roe = (unrealizedPnl / pos.margin) * 100;

      return {
        ...pos,
        markPrice,
        unrealizedPnl,
        roe,
        marginRatio: pos.margin > 0 ? (Math.abs(unrealizedPnl) / pos.margin) * 100 : 0,
      };
    });
  }

  getTradeHistory(filters = {}) {
    const db = getDb();
    let query = 'SELECT * FROM trades WHERE 1=1';
    const params = [];

    if (filters.symbol) { query += ' AND symbol = ?'; params.push(filters.symbol); }
    if (filters.marketType) { query += ' AND market_type = ?'; params.push(filters.marketType); }
    if (filters.startDate) { query += ' AND executed_at >= ?'; params.push(filters.startDate); }
    if (filters.endDate) { query += ' AND executed_at <= ?'; params.push(filters.endDate); }

    query += ' ORDER BY executed_at DESC';
    if (filters.limit) { query += ' LIMIT ?'; params.push(filters.limit); }
    if (filters.offset) { query += ' OFFSET ?'; params.push(filters.offset); }

    return db.prepare(query).all(...params);
  }

  getTradeSummary() {
    const db = getDb();
    const all = db.prepare('SELECT * FROM trades ORDER BY executed_at DESC').all();

    const totalTrades = all.length;
    const totalFees = all.reduce((s, t) => s + t.fee, 0);
    const totalPnl = all.reduce((s, t) => s + t.realized_pnl, 0);
    const wins = all.filter(t => t.realized_pnl > 0);
    const losses = all.filter(t => t.realized_pnl < 0);

    // Daily summary
    const daily = {};
    for (const t of all) {
      const day = t.executed_at.split('T')[0] || t.executed_at.split(' ')[0];
      if (!daily[day]) daily[day] = { date: day, trades: 0, pnl: 0, fees: 0 };
      daily[day].trades++;
      daily[day].pnl += t.realized_pnl;
      daily[day].fees += t.fee;
    }

    return {
      totalTrades,
      totalFees,
      totalPnl,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0,
      avgWin: wins.length > 0 ? wins.reduce((s, t) => s + t.realized_pnl, 0) / wins.length : 0,
      avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + t.realized_pnl, 0) / losses.length : 0,
      dailySummary: Object.values(daily).sort((a, b) => b.date.localeCompare(a.date)),
    };
  }

  // --- Portfolio Snapshots ---
  async takeSnapshot() {
    const db = getDb();
    const portfolio = await this.getPortfolio();
    db.prepare(`
      INSERT INTO portfolio_snapshots (total_value_usdt, spot_value, futures_value, unrealized_pnl)
      VALUES (?, ?, ?, ?)
    `).run(portfolio.totalValue, portfolio.spotValue, portfolio.futuresValue, portfolio.unrealizedPnl);
  }

  getPortfolioHistory(limit = 500) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM portfolio_snapshots ORDER BY snapshot_at DESC LIMIT ?'
    ).all(limit).reverse();
  }
}

const tradingEngine = new TradingEngine();
export default tradingEngine;
