import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';
import { formatUSD, formatCrypto, formatNumber, pnlColor, priceDecimals } from '../lib/format';
import { ArrowUpCircle, ArrowDownCircle, X, RefreshCw } from 'lucide-react';

const POPULAR_PAIRS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
];

function formatExecutionToast(order, side, symbol) {
  if (order.executionEnv && order.executionEnv !== 'paper') {
    const remoteState = order.remoteStatus || order.status || 'accepted';
    const exchangeId = order.exchangeOrderId ? ` • Binance ID ${order.exchangeOrderId}` : '';
    return `Live Binance ${remoteState}: ${side.toUpperCase()} ${symbol}${exchangeId}`;
  }

  return `Paper ${order.status || 'filled'}: ${side.toUpperCase()} ${symbol}`;
}

export default function TradingTerminal() {
  const { ws, addToast, config } = useApp();
  const [selectedPair, setSelectedPair] = useState('BTCUSDT');
  const [candles, setCandles] = useState([]);
  const [orderBook, setOrderBook] = useState({ bids: [], asks: [] });
  const [openOrders, setOpenOrders] = useState([]);
  const [positions, setPositions] = useState([]);
  const [timeframe, setTimeframe] = useState('1h');

  // Order form state
  const [marketType, setMarketType] = useState('spot');
  const [orderType, setOrderType] = useState('market');
  const [side, setSide] = useState('buy');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [quantityPercent, setQuantityPercent] = useState(0);
  const [leverage, setLeverage] = useState(1);
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [loading, setLoading] = useState(false);

  const chartRef = useRef(null);
  const chartInstance = useRef(null);
  const seriesRef = useRef(null);

  const currentPrice = ws.prices[selectedPair] || 0;
  const dec = priceDecimals(currentPrice);
  const isLiveFuturesContext = config?.trading_mode === 'live'
    && config?.binance_execution_env === 'live'
    && config?.binance_futures_live_enabled;

  // Load candles
  useEffect(() => {
    api.getCandles(selectedPair, timeframe, 500)
      .then(setCandles)
      .catch(() => {});
  }, [selectedPair, timeframe]);

  // Load order book
  useEffect(() => {
    api.getOrderBook(selectedPair).then(setOrderBook).catch(() => {});
    const iv = setInterval(() => {
      api.getOrderBook(selectedPair).then(setOrderBook).catch(() => {});
    }, 5000);
    return () => clearInterval(iv);
  }, [selectedPair]);

  // Load open orders and positions
  useEffect(() => {
    const load = () => {
      api.getOpenOrders().then(setOpenOrders).catch(() => {});
      api.getPositions().then(setPositions).catch(() => {});
    };
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  // TradingView Lightweight Charts
  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;

    let chart;
    import('lightweight-charts').then(({ createChart }) => {
      if (chartInstance.current) {
        chartInstance.current.remove();
      }

      chart = createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height: chartRef.current.clientHeight,
        layout: {
          background: { color: '#0b0e11' },
          textColor: '#94a3b8',
          fontSize: 12,
        },
        grid: {
          vertLines: { color: '#1e293b' },
          horzLines: { color: '#1e293b' },
        },
        crosshair: { mode: 0 },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: { borderColor: '#334155', timeVisible: true },
      });

      const series = chart.addCandlestickSeries({
        upColor: '#10b981',
        downColor: '#ef4444',
        borderUpColor: '#10b981',
        borderDownColor: '#ef4444',
        wickUpColor: '#10b981',
        wickDownColor: '#ef4444',
      });

      const data = candles.map(c => ({
        time: Math.floor(c.openTime / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      series.setData(data);

      // Volume
      const volSeries = chart.addHistogramSeries({
        color: '#334155',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volSeries.setData(candles.map(c => ({
        time: Math.floor(c.openTime / 1000),
        value: c.volume,
        color: c.close >= c.open ? '#10b98133' : '#ef444433',
      })));

      chart.timeScale().fitContent();
      chartInstance.current = chart;
      seriesRef.current = series;
    });

    const resizeObs = new ResizeObserver(() => {
      if (chartInstance.current && chartRef.current) {
        chartInstance.current.applyOptions({
          width: chartRef.current.clientWidth,
          height: chartRef.current.clientHeight,
        });
      }
    });
    resizeObs.observe(chartRef.current);

    return () => {
      resizeObs.disconnect();
      if (chart) chart.remove();
    };
  }, [candles]);

  // Update chart with realtime data
  useEffect(() => {
    if (!seriesRef.current || !currentPrice) return;
    const now = Math.floor(Date.now() / 1000);
    seriesRef.current.update({
      time: now - (now % 3600),
      open: currentPrice,
      high: currentPrice,
      low: currentPrice,
      close: currentPrice,
    });
  }, [currentPrice]);

  // Subscribe to depth
  useEffect(() => {
    ws.send({ type: 'subscribe_depth', symbol: selectedPair });
  }, [selectedPair, ws.send]);

  const handleOrder = async () => {
    setLoading(true);
    try {
      const params = {
        symbol: selectedPair,
        side,
        type: orderType,
        marketType,
        leverage: marketType === 'futures' ? leverage : 1,
        source: 'manual',
      };

      if (orderType !== 'market' && price) params.price = parseFloat(price);
      if (quantity) params.quantity = parseFloat(quantity);
      else if (quantityPercent > 0) params.quantityPercent = quantityPercent;
      if (takeProfit) params.takeProfit = parseFloat(takeProfit);
      if (stopLoss) params.stopLoss = parseFloat(stopLoss);

      const order = await api.placeOrder(params);
      addToast(formatExecutionToast(order, side, selectedPair), 'success');
      setQuantity('');
      setQuantityPercent(0);
      setTakeProfit('');
      setStopLoss('');
      api.getOpenOrders().then(setOpenOrders);
      api.getPositions().then(setPositions);
    } catch (err) {
      addToast(err.message, 'error');
    }
    setLoading(false);
  };

  const cancelOrder = async (id) => {
    try {
      await api.cancelOrder(id);
      addToast('Order cancelled', 'info');
      api.getOpenOrders().then(setOpenOrders);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const closePosition = async (id) => {
    try {
      const result = await api.closePosition(id);
      const closeMessage = result.executionEnv && result.executionEnv !== 'paper'
        ? `Live Binance close submitted${result.exchangeOrderId ? ` • Binance ID ${result.exchangeOrderId}` : ''}. PnL: ${formatUSD(result.pnl)}`
        : `Paper position closed. PnL: ${formatUSD(result.pnl)}`;
      addToast(closeMessage, result.pnl >= 0 ? 'success' : 'warning');
      api.getPositions().then(setPositions);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="flex h-full">
      {/* Left: Chart + Order Book + Orders */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Pair selector + Intervals */}
        <div className="flex items-center gap-2 px-3 py-2 bg-[#12151a] border-b border-slate-800/50">
          <select
            value={selectedPair}
            onChange={e => setSelectedPair(e.target.value)}
            className="bg-slate-800 text-white text-sm px-3 py-1.5 rounded border border-slate-700 focus:border-yellow-500 outline-none"
          >
            {POPULAR_PAIRS.map(p => (
              <option key={p} value={p}>{p.replace('USDT', '/USDT')}</option>
            ))}
          </select>

          <span className={`text-xl font-bold ml-2 ${currentPrice > 0 ? 'text-white' : 'text-slate-500'}`}>
            {currentPrice > 0 ? formatNumber(currentPrice, dec) : '—'}
          </span>

          <div className="flex gap-1 ml-auto">
            {['1m', '5m', '15m', '1h', '4h', '1d'].map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 text-xs rounded ${
                  timeframe === tf ? 'bg-yellow-500/20 text-yellow-400' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div ref={chartRef} className="flex-1 min-h-[300px]" />

        {/* Bottom: Order Book + Open Orders + Positions */}
        <div className="h-[280px] flex border-t border-slate-800/50">
          {/* Mini Order Book */}
          <div className="w-[280px] border-r border-slate-800/50 overflow-auto p-2">
            <div className="text-xs text-slate-500 font-medium mb-1">Order Book</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500">
                  <td className="pb-1">Price</td>
                  <td className="text-right pb-1">Amount</td>
                </tr>
              </thead>
              <tbody>
                {orderBook.asks?.slice(0, 8).reverse().map((ask, i) => (
                  <tr key={`a${i}`} className="text-red-400">
                    <td className="py-0.5">{formatNumber(ask[0], dec)}</td>
                    <td className="text-right">{formatCrypto(ask[1], 4)}</td>
                  </tr>
                ))}
                <tr className="border-y border-slate-800">
                  <td colSpan={2} className="py-1 text-center font-bold text-white text-sm">
                    {formatNumber(currentPrice, dec)}
                  </td>
                </tr>
                {orderBook.bids?.slice(0, 8).map((bid, i) => (
                  <tr key={`b${i}`} className="text-emerald-400">
                    <td className="py-0.5">{formatNumber(bid[0], dec)}</td>
                    <td className="text-right">{formatCrypto(bid[1], 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Open Orders */}
          <div className="flex-1 overflow-auto p-2">
            <div className="flex gap-4 mb-2">
              <span className="text-xs text-slate-500 font-medium">
                Open Orders ({openOrders.length})
              </span>
              <span className="text-xs text-slate-500 font-medium">
                Positions ({positions.length})
              </span>
            </div>

            {positions.length > 0 && (
              <table className="w-full text-xs mb-3">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <td className="pb-1">Symbol</td>
                    <td>Side</td>
                    <td>Venue</td>
                    <td>Size</td>
                    <td>Entry</td>
                    <td>Mark</td>
                    <td>Liq.</td>
                    <td>PnL</td>
                    <td>ROE%</td>
                    <td></td>
                  </tr>
                </thead>
                <tbody>
                  {positions.map(pos => (
                    <tr key={pos.id} className="border-b border-slate-800/50">
                      <td className="py-1.5 font-medium">{pos.symbol}</td>
                      <td className={pos.side === 'long' ? 'text-emerald-400' : 'text-red-400'}>
                        {pos.side.toUpperCase()} {pos.leverage}x
                      </td>
                      <td>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
                          pos.execution_env && pos.execution_env !== 'paper'
                            ? 'bg-cyan-500/10 text-cyan-300'
                            : 'bg-slate-700 text-slate-300'
                        }`}>
                          {pos.execution_env && pos.execution_env !== 'paper' ? 'Binance' : 'Paper'}
                        </span>
                        {pos.execution_env !== 'paper' && isLiveFuturesContext && (
                          <div className="text-[10px] text-slate-500 mt-0.5">Synced live futures position</div>
                        )}
                      </td>
                      <td>{formatCrypto(pos.quantity, 4)}</td>
                      <td>{formatNumber(pos.entry_price, dec)}</td>
                      <td>{formatNumber(pos.markPrice, dec)}</td>
                      <td className="text-yellow-400">{formatNumber(pos.liquidation_price, dec)}</td>
                      <td className={pnlColor(pos.unrealizedPnl)}>{formatUSD(pos.unrealizedPnl)}</td>
                      <td className={pnlColor(pos.roe)}>{pos.roe?.toFixed(2)}%</td>
                      <td>
                        <button
                          onClick={() => closePosition(pos.id)}
                          className="text-red-400 hover:text-red-300 text-xs"
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {openOrders.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <td className="pb-1">Symbol</td>
                    <td>Type</td>
                    <td>Venue</td>
                    <td>Side</td>
                    <td>Price</td>
                    <td>Qty</td>
                    <td>Filled</td>
                    <td></td>
                  </tr>
                </thead>
                <tbody>
                  {openOrders.map(order => (
                    <tr key={order.id} className="border-b border-slate-800/50">
                      <td className="py-1.5">{order.symbol}</td>
                      <td className="capitalize">{order.type}</td>
                      <td>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
                          order.execution_env && order.execution_env !== 'paper'
                            ? 'bg-cyan-500/10 text-cyan-300'
                            : 'bg-slate-700 text-slate-300'
                        }`}>
                          {order.execution_env && order.execution_env !== 'paper' ? 'Binance' : 'Paper'}
                        </span>
                        {order.exchange_order_id && (
                          <div className="text-[10px] text-slate-500 mt-0.5">ID {order.exchange_order_id}</div>
                        )}
                      </td>
                      <td className={order.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}>
                        {order.side.toUpperCase()}
                      </td>
                      <td>{order.price ? formatNumber(order.price, dec) : 'Market'}</td>
                      <td>{formatCrypto(order.quantity, 4)}</td>
                      <td>{formatCrypto(order.filled_quantity, 4)}</td>
                      <td>
                        <button onClick={() => cancelOrder(order.id)} className="text-slate-400 hover:text-red-400">
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {openOrders.length === 0 && positions.length === 0 && (
              <div className="text-slate-500 text-xs text-center py-6">No open orders or positions</div>
            )}
          </div>
        </div>
      </div>

      {/* Right: Order Entry Panel */}
      <div className="w-[320px] bg-[#12151a] border-l border-slate-800/50 flex flex-col overflow-auto">
        <div className="p-3 space-y-3">
          {/* Spot / Futures toggle */}
          <div className="flex rounded bg-slate-800/50">
            {['spot', 'futures'].map(t => (
              <button
                key={t}
                onClick={() => setMarketType(t)}
                className={`flex-1 py-2 text-sm font-medium rounded capitalize ${
                  marketType === t ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Order type tabs */}
          <div className="flex gap-1">
            {['market', 'limit', 'stop_limit'].map(t => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={`px-3 py-1.5 text-xs rounded capitalize ${
                  orderType === t ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {t.replace('_', '-')}
              </button>
            ))}
          </div>

          {/* Buy/Sell toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setSide('buy')}
              className={`flex-1 py-2.5 rounded font-semibold text-sm flex items-center justify-center gap-2 ${
                side === 'buy'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
              }`}
            >
              <ArrowUpCircle size={16} />
              {marketType === 'futures' ? 'Long' : 'Buy'}
            </button>
            <button
              onClick={() => setSide('sell')}
              className={`flex-1 py-2.5 rounded font-semibold text-sm flex items-center justify-center gap-2 ${
                side === 'sell'
                  ? 'bg-red-500 text-white'
                  : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
              }`}
            >
              <ArrowDownCircle size={16} />
              {marketType === 'futures' ? 'Short' : 'Sell'}
            </button>
          </div>

          {/* Price input for limit orders */}
          {orderType !== 'market' && (
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Price (USDT)</label>
              <input
                type="number"
                value={price}
                onChange={e => setPrice(e.target.value)}
                placeholder={currentPrice ? formatNumber(currentPrice, dec) : '0.00'}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:border-yellow-500"
              />
            </div>
          )}

          {/* Quantity */}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">
              Amount ({selectedPair.replace('USDT', '')})
            </label>
            <input
              type="number"
              value={quantity}
              onChange={e => { setQuantity(e.target.value); setQuantityPercent(0); }}
              placeholder="0.00"
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:border-yellow-500"
            />
          </div>

          {/* Quick percent buttons */}
          <div className="flex gap-1">
            {[10, 25, 50, 75, 100].map(pct => (
              <button
                key={pct}
                onClick={() => { setQuantityPercent(pct); setQuantity(''); }}
                className={`flex-1 py-1.5 text-xs rounded ${
                  quantityPercent === pct
                    ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {pct}%
              </button>
            ))}
          </div>

          {/* Leverage slider for futures */}
          {marketType === 'futures' && (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500">Leverage</span>
                <span className="text-yellow-400 font-semibold">{leverage}x</span>
              </div>
              <input
                type="range"
                min={1}
                max={125}
                value={leverage}
                onChange={e => setLeverage(parseInt(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-slate-600 mt-1">
                <span>1x</span>
                <span>25x</span>
                <span>50x</span>
                <span>75x</span>
                <span>125x</span>
              </div>
            </div>
          )}

          {/* TP/SL */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-slate-500 mb-1 block">Take Profit</label>
              <input
                type="number"
                value={takeProfit}
                onChange={e => setTakeProfit(e.target.value)}
                placeholder="—"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-500 mb-1 block">Stop Loss</label>
              <input
                type="number"
                value={stopLoss}
                onChange={e => setStopLoss(e.target.value)}
                placeholder="—"
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:border-red-500"
              />
            </div>
          </div>

          {/* Order summary */}
          {currentPrice > 0 && (quantity || quantityPercent > 0) && (
            <div className="bg-slate-800/50 rounded p-2.5 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Est. Cost</span>
                <span>
                  {formatUSD(
                    quantity
                      ? parseFloat(quantity) * currentPrice
                      : 0
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Fee (0.1%)</span>
                <span>
                  {formatUSD(
                    quantity
                      ? parseFloat(quantity) * currentPrice * 0.001
                      : 0
                  )}
                </span>
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleOrder}
            disabled={loading || (!quantity && quantityPercent === 0)}
            className={`w-full py-3 rounded font-semibold text-sm transition-colors ${
              side === 'buy'
                ? 'bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/30'
                : 'bg-red-500 hover:bg-red-600 disabled:bg-red-500/30'
            } disabled:cursor-not-allowed`}
          >
            {loading ? 'Placing...' : `${side === 'buy' ? (marketType === 'futures' ? 'Long' : 'Buy') : (marketType === 'futures' ? 'Short' : 'Sell')} ${selectedPair.replace('USDT', '')}`}
          </button>
        </div>
      </div>
    </div>
  );
}
