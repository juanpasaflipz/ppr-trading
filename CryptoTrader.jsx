import { useState, useEffect, useReducer, useCallback, useMemo, useRef, memo } from "react";
import {
  TrendingUp, TrendingDown, DollarSign, BarChart3, Clock, Zap,
  AlertTriangle, CheckCircle, RefreshCw, Eye, EyeOff, Trash2,
  ChevronDown, ChevronUp, Search, Star, X, ArrowUpDown, Wallet,
  Activity, Shield, Settings, Bell, Menu, ArrowUp, ArrowDown,
  Minus, Plus, Percent, Target, Crosshair
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer,
  BarChart, Bar, LineChart, Line, CartesianGrid, ComposedChart,
  Cell, PieChart, Pie, Legend
} from "recharts";
import _ from "lodash";

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS & CONFIG
// ═══════════════════════════════════════════════════════════════════
const DEFAULT_BALANCE = 100000;
const SPOT_FEE = 0.001;
const FUTURES_FEE = 0.0002;
const MAKER_FEE = 0.0001;
const MAX_LEVERAGE = 125;
const BINANCE_REST = "https://api.binance.com/api/v3";
const BINANCE_WS = "wss://stream.binance.com:9443/ws";

const SYMBOLS = [
  { symbol: "BTCUSDT", base: "BTC", quote: "USDT", icon: "₿", decimals: 2 },
  { symbol: "ETHUSDT", base: "ETH", quote: "USDT", icon: "Ξ", decimals: 2 },
  { symbol: "BNBUSDT", base: "BNB", quote: "USDT", icon: "◆", decimals: 2 },
  { symbol: "SOLUSDT", base: "SOL", quote: "USDT", icon: "◎", decimals: 2 },
  { symbol: "XRPUSDT", base: "XRP", quote: "USDT", icon: "✕", decimals: 4 },
  { symbol: "ADAUSDT", base: "ADA", quote: "USDT", icon: "₳", decimals: 4 },
  { symbol: "DOGEUSDT", base: "DOGE", quote: "USDT", icon: "Ð", decimals: 5 },
  { symbol: "DOTUSDT", base: "DOT", quote: "USDT", icon: "●", decimals: 3 },
  { symbol: "AVAXUSDT", base: "AVAX", quote: "USDT", icon: "▲", decimals: 3 },
  { symbol: "LINKUSDT", base: "LINK", quote: "USDT", icon: "⬡", decimals: 3 },
];

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];
const LEVERAGE_PRESETS = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125];

// ═══════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════
const fmt = (n, d = 2) => {
  if (n === null || n === undefined || isNaN(n)) return "0.00";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const fmtUSD = (n) => "$" + fmt(n, 2);
const fmtPct = (n) => (n >= 0 ? "+" : "") + fmt(n, 2) + "%";
const fmtQty = (n, d = 6) => fmt(n, d);
const pnlColor = (n) => (n > 0 ? "text-emerald-400" : n < 0 ? "text-red-400" : "text-slate-400");
const pnlBg = (n) => (n > 0 ? "bg-emerald-500/10" : n < 0 ? "bg-red-500/10" : "bg-slate-500/10");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const calcLiqPrice = (entry, leverage, side) => {
  if (side === "LONG") return entry * ((leverage - 1) / leverage);
  return entry * ((leverage + 1) / leverage);
};

const calcUnrealizedPnL = (entry, current, qty, side) => {
  if (side === "LONG") return (current - entry) * qty;
  return (entry - current) * qty;
};

const calcROE = (pnl, margin) => (margin > 0 ? (pnl / margin) * 100 : 0);

const calcMarginRequired = (qty, price, leverage) => (qty * price) / leverage;

const getSymbolConfig = (sym) => SYMBOLS.find((s) => s.symbol === sym) || SYMBOLS[0];

const timeAgo = (ts) => {
  const diff = Date.now() - ts;
  if (diff < 60000) return Math.floor(diff / 1000) + "s ago";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return Math.floor(diff / 86400000) + "d ago";
};

// ═══════════════════════════════════════════════════════════════════
// REDUCER & STATE
// ═══════════════════════════════════════════════════════════════════
const createInitialState = (balance = DEFAULT_BALANCE) => ({
  balance,
  startingBalance: balance,
  balances: { USDT: balance },
  positions: [],
  spotOrders: [],
  futuresOrders: [],
  tradeHistory: [],
  markets: {},
  orderBooks: {},
  klines: {},
  selectedSymbol: "BTCUSDT",
  activeTab: "spot",
  timeframe: "1h",
  wsConnected: {},
  notifications: [],
  totalPnL: 0,
  totalRealizedPnL: 0,
});

function reducer(state, action) {
  switch (action.type) {
    case "SET_MARKET_DATA": {
      const { symbol, data } = action.payload;
      return {
        ...state,
        markets: { ...state.markets, [symbol]: { ...state.markets[symbol], ...data } },
      };
    }
    case "SET_ORDER_BOOK": {
      const { symbol, bids, asks } = action.payload;
      return {
        ...state,
        orderBooks: { ...state.orderBooks, [symbol]: { bids: bids.slice(0, 20), asks: asks.slice(0, 20) } },
      };
    }
    case "SET_KLINES": {
      const { key, data } = action.payload;
      return { ...state, klines: { ...state.klines, [key]: data } };
    }
    case "UPDATE_PRICE": {
      const { symbol, price, change24h, changePercent, high, low, volume } = action.payload;
      const prev = state.markets[symbol] || {};
      const newMarkets = {
        ...state.markets,
        [symbol]: { ...prev, price, change24h, changePercent, high24h: high, low24h: low, volume24h: volume, lastUpdate: Date.now() },
      };
      // Update unrealized PnL for positions
      let totalUnrealized = 0;
      const updatedPositions = state.positions.map((pos) => {
        const curPrice = pos.symbol === symbol ? price : (newMarkets[pos.symbol]?.price || pos.entryPrice);
        const pnl = calcUnrealizedPnL(pos.entryPrice, curPrice, pos.quantity, pos.side);
        const roe = calcROE(pnl, pos.margin);
        const liqPrice = pos.liquidationPrice;
        const isLiquidated =
          (pos.side === "LONG" && curPrice <= liqPrice) ||
          (pos.side === "SHORT" && curPrice >= liqPrice);
        totalUnrealized += pnl;
        return { ...pos, unrealizedPnL: pnl, roe, markPrice: curPrice, isLiquidated };
      });
      // Auto-liquidate
      const liquidated = updatedPositions.filter((p) => p.isLiquidated);
      const remaining = updatedPositions.filter((p) => !p.isLiquidated);
      let newBalance = state.balance;
      let newRealizedPnL = state.totalRealizedPnL;
      const newHistory = [...state.tradeHistory];
      const newNotifications = [...state.notifications];
      liquidated.forEach((p) => {
        const loss = -p.margin;
        newBalance += loss;
        newRealizedPnL += loss;
        newHistory.unshift({
          id: uid(), symbol: p.symbol, side: p.side, type: "LIQUIDATION",
          quantity: p.quantity, entryPrice: p.entryPrice, exitPrice: p.side === "LONG" ? p.liquidationPrice : p.liquidationPrice,
          pnl: loss, roe: -100, leverage: p.leverage, closedAt: Date.now(), fee: 0,
        });
        newNotifications.unshift({
          id: uid(), type: "liquidation", message: `${p.side} ${p.symbol} position liquidated! Lost ${fmtUSD(Math.abs(loss))}`, ts: Date.now(),
        });
      });
      return {
        ...state,
        markets: newMarkets,
        positions: remaining,
        balance: newBalance,
        totalPnL: totalUnrealized + newRealizedPnL,
        totalRealizedPnL: newRealizedPnL,
        tradeHistory: newHistory,
        notifications: newNotifications.slice(0, 50),
      };
    }
    case "SPOT_BUY": {
      const { symbol, quantity, price } = action.payload;
      const cfg = getSymbolConfig(symbol);
      const cost = quantity * price;
      const fee = cost * SPOT_FEE;
      const total = cost + fee;
      if ((state.balances.USDT || 0) < total) return state;
      const newBalances = { ...state.balances };
      newBalances.USDT = (newBalances.USDT || 0) - total;
      newBalances[cfg.base] = (newBalances[cfg.base] || 0) + quantity;
      const order = {
        id: uid(), symbol, side: "BUY", type: "MARKET", quantity, price, cost, fee, status: "FILLED", createdAt: Date.now(),
      };
      return {
        ...state,
        balances: newBalances,
        balance: Object.entries(newBalances).reduce((sum, [k, v]) => {
          if (k === "USDT") return sum + v;
          const mp = state.markets[k + "USDT"]?.price || 0;
          return sum + v * mp;
        }, 0),
        spotOrders: [order, ...state.spotOrders],
        tradeHistory: [{ ...order, pnl: -fee, closedAt: Date.now() }, ...state.tradeHistory],
        notifications: [{ id: uid(), type: "success", message: `Bought ${fmtQty(quantity, 6)} ${cfg.base} at ${fmtUSD(price)}`, ts: Date.now() }, ...state.notifications].slice(0, 50),
      };
    }
    case "SPOT_SELL": {
      const { symbol, quantity, price } = action.payload;
      const cfg = getSymbolConfig(symbol);
      if ((state.balances[cfg.base] || 0) < quantity) return state;
      const revenue = quantity * price;
      const fee = revenue * SPOT_FEE;
      const net = revenue - fee;
      const newBalances = { ...state.balances };
      newBalances[cfg.base] = (newBalances[cfg.base] || 0) - quantity;
      newBalances.USDT = (newBalances.USDT || 0) + net;
      if (newBalances[cfg.base] <= 0.00000001) delete newBalances[cfg.base];
      const order = {
        id: uid(), symbol, side: "SELL", type: "MARKET", quantity, price, revenue: net, fee, status: "FILLED", createdAt: Date.now(),
      };
      return {
        ...state,
        balances: newBalances,
        spotOrders: [order, ...state.spotOrders],
        tradeHistory: [{ ...order, pnl: -fee, closedAt: Date.now() }, ...state.tradeHistory],
        notifications: [{ id: uid(), type: "success", message: `Sold ${fmtQty(quantity, 6)} ${cfg.base} at ${fmtUSD(price)}`, ts: Date.now() }, ...state.notifications].slice(0, 50),
      };
    }
    case "SPOT_LIMIT_ORDER": {
      const { symbol, side, quantity, price } = action.payload;
      const cfg = getSymbolConfig(symbol);
      if (side === "BUY") {
        const cost = quantity * price * (1 + SPOT_FEE);
        if ((state.balances.USDT || 0) < cost) return state;
      } else {
        if ((state.balances[cfg.base] || 0) < quantity) return state;
      }
      const order = {
        id: uid(), symbol, side, type: "LIMIT", quantity, price, status: "OPEN", createdAt: Date.now(),
      };
      return {
        ...state,
        spotOrders: [order, ...state.spotOrders],
        notifications: [{ id: uid(), type: "info", message: `Limit ${side} ${fmtQty(quantity, 6)} ${cfg.base} at ${fmtUSD(price)}`, ts: Date.now() }, ...state.notifications].slice(0, 50),
      };
    }
    case "CANCEL_SPOT_ORDER": {
      return {
        ...state,
        spotOrders: state.spotOrders.map((o) => o.id === action.payload ? { ...o, status: "CANCELLED" } : o),
      };
    }
    case "OPEN_POSITION": {
      const { symbol, side, quantity, price, leverage } = action.payload;
      const margin = calcMarginRequired(quantity, price, leverage);
      const fee = quantity * price * FUTURES_FEE;
      const totalCost = margin + fee;
      if (state.balance < totalCost) return state;
      const liqPrice = calcLiqPrice(price, leverage, side);
      const position = {
        id: uid(), symbol, side, quantity, entryPrice: price, leverage, margin,
        liquidationPrice: liqPrice, unrealizedPnL: 0, roe: 0, markPrice: price,
        createdAt: Date.now(), isLiquidated: false, tp: null, sl: null,
      };
      return {
        ...state,
        balance: state.balance - totalCost,
        positions: [position, ...state.positions],
        futuresOrders: [{ id: uid(), symbol, side, type: "MARKET", quantity, price, leverage, fee, status: "FILLED", createdAt: Date.now() }, ...state.futuresOrders],
        notifications: [{ id: uid(), type: "success", message: `Opened ${leverage}x ${side} ${getSymbolConfig(symbol).base} — Margin: ${fmtUSD(margin)}`, ts: Date.now() }, ...state.notifications].slice(0, 50),
      };
    }
    case "CLOSE_POSITION": {
      const pos = state.positions.find((p) => p.id === action.payload.id);
      if (!pos) return state;
      const exitPrice = action.payload.price || state.markets[pos.symbol]?.price || pos.entryPrice;
      const pnl = calcUnrealizedPnL(pos.entryPrice, exitPrice, pos.quantity, pos.side);
      const fee = pos.quantity * exitPrice * FUTURES_FEE;
      const netPnl = pnl - fee;
      const returnAmount = pos.margin + netPnl;
      return {
        ...state,
        balance: state.balance + Math.max(0, returnAmount),
        positions: state.positions.filter((p) => p.id !== pos.id),
        totalRealizedPnL: state.totalRealizedPnL + netPnl,
        tradeHistory: [{
          id: uid(), symbol: pos.symbol, side: pos.side, type: "FUTURES", quantity: pos.quantity,
          entryPrice: pos.entryPrice, exitPrice, pnl: netPnl, roe: calcROE(netPnl, pos.margin),
          leverage: pos.leverage, closedAt: Date.now(), fee,
        }, ...state.tradeHistory],
        notifications: [{
          id: uid(), type: netPnl >= 0 ? "success" : "warning",
          message: `Closed ${pos.side} ${getSymbolConfig(pos.symbol).base} — PnL: ${netPnl >= 0 ? "+" : ""}${fmtUSD(netPnl)}`,
          ts: Date.now(),
        }, ...state.notifications].slice(0, 50),
      };
    }
    case "SET_TP_SL": {
      const { id, tp, sl } = action.payload;
      return {
        ...state,
        positions: state.positions.map((p) => p.id === id ? { ...p, tp, sl } : p),
      };
    }
    case "SELECT_SYMBOL":
      return { ...state, selectedSymbol: action.payload };
    case "SET_TAB":
      return { ...state, activeTab: action.payload };
    case "SET_TIMEFRAME":
      return { ...state, timeframe: action.payload };
    case "WS_STATUS":
      return { ...state, wsConnected: { ...state.wsConnected, [action.payload.symbol]: action.payload.connected } };
    case "DISMISS_NOTIFICATION":
      return { ...state, notifications: state.notifications.filter((n) => n.id !== action.payload) };
    case "SET_BALANCE": {
      const bal = action.payload;
      return { ...createInitialState(bal), markets: state.markets, orderBooks: state.orderBooks, klines: state.klines, wsConnected: state.wsConnected };
    }
    case "RESET_ACCOUNT":
      return { ...createInitialState(state.startingBalance), markets: state.markets, orderBooks: state.orderBooks, klines: state.klines, wsConnected: state.wsConnected };
    default:
      return state;
  }
}

// ═══════════════════════════════════════════════════════════════════
// CUSTOM HOOKS
// ═══════════════════════════════════════════════════════════════════
function useBinanceData(dispatch, started) {
  const wsRefs = useRef({});
  const reconnectTimers = useRef({});
  const closedRef = useRef(true);

  const fetchInitialData = useCallback(async () => {
    try {
      // Fetch only our symbols, not the entire ticker list
      const requests = SYMBOLS.map((s) =>
        fetch(`${BINANCE_REST}/ticker/24hr?symbol=${s.symbol}`)
          .then((r) => r.json())
          .catch(() => null)
      );
      const results = await Promise.all(requests);
      results.forEach((t) => {
        if (!t || !t.symbol) return;
        dispatch({
          type: "SET_MARKET_DATA",
          payload: {
            symbol: t.symbol,
            data: {
              price: parseFloat(t.lastPrice),
              change24h: parseFloat(t.priceChange),
              changePercent: parseFloat(t.priceChangePercent),
              high24h: parseFloat(t.highPrice),
              low24h: parseFloat(t.lowPrice),
              volume24h: parseFloat(t.quoteVolume),
              lastUpdate: Date.now(),
            },
          },
        });
      });
    } catch (e) {
      console.error("Failed to fetch tickers:", e);
    }
  }, [dispatch]);

  const fetchOrderBook = useCallback(async (symbol) => {
    try {
      const data = await fetch(`${BINANCE_REST}/depth?symbol=${symbol}&limit=20`).then((r) => r.json());
      if (!data.bids || !data.asks) return;
      dispatch({
        type: "SET_ORDER_BOOK",
        payload: {
          symbol,
          bids: data.bids.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
          asks: data.asks.map(([p, q]) => [parseFloat(p), parseFloat(q)]),
        },
      });
    } catch (e) {
      console.error("Failed to fetch order book:", e);
    }
  }, [dispatch]);

  const fetchKlines = useCallback(async (symbol, interval) => {
    try {
      const data = await fetch(`${BINANCE_REST}/klines?symbol=${symbol}&interval=${interval}&limit=120`).then((r) => r.json());
      if (!Array.isArray(data)) return;
      const klines = data.map((k) => ({
        time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
      }));
      dispatch({ type: "SET_KLINES", payload: { key: `${symbol}_${interval}`, data: klines } });
    } catch (e) {
      console.error("Failed to fetch klines:", e);
    }
  }, [dispatch]);

  const connectWS = useCallback((symbol) => {
    if (closedRef.current) return;
    if (wsRefs.current[symbol]) {
      try { wsRefs.current[symbol].close(); } catch (e) {}
    }
    const streamName = symbol.toLowerCase();
    const ws = new WebSocket(`${BINANCE_WS}/${streamName}@miniTicker`);
    wsRefs.current[symbol] = ws;

    ws.onopen = () => {
      dispatch({ type: "WS_STATUS", payload: { symbol, connected: true } });
    };
    ws.onmessage = (event) => {
      try {
        const d = JSON.parse(event.data);
        dispatch({
          type: "UPDATE_PRICE",
          payload: {
            symbol: d.s, price: parseFloat(d.c),
            change24h: parseFloat(d.c) - parseFloat(d.o),
            changePercent: ((parseFloat(d.c) - parseFloat(d.o)) / parseFloat(d.o)) * 100,
            high: parseFloat(d.h), low: parseFloat(d.l), volume: parseFloat(d.q),
          },
        });
      } catch (e) {}
    };
    ws.onclose = () => {
      dispatch({ type: "WS_STATUS", payload: { symbol, connected: false } });
      if (!closedRef.current) {
        reconnectTimers.current[symbol] = setTimeout(() => connectWS(symbol), 3000);
      }
    };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }, [dispatch]);

  useEffect(() => {
    if (!started) return;
    closedRef.current = false;
    fetchInitialData();
    SYMBOLS.forEach((s) => connectWS(s.symbol));
    return () => {
      closedRef.current = true;
      Object.values(reconnectTimers.current).forEach(clearTimeout);
      reconnectTimers.current = {};
      Object.values(wsRefs.current).forEach((ws) => { try { ws.close(); } catch (e) {} });
      wsRefs.current = {};
    };
  }, [started]);

  return { fetchOrderBook, fetchKlines };
}

// ═══════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════

// --- Notification Toast ---
const NotificationToast = memo(({ notifications, dispatch }) => {
  if (notifications.length === 0) return null;
  const latest = notifications[0];
  const bgMap = { success: "bg-emerald-500/20 border-emerald-500/40", warning: "bg-amber-500/20 border-amber-500/40", liquidation: "bg-red-500/20 border-red-500/40", info: "bg-blue-500/20 border-blue-500/40" };
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2" style={{ maxWidth: 380 }}>
      {notifications.slice(0, 3).map((n) => (
        <div key={n.id} className={`${bgMap[n.type] || bgMap.info} border rounded-lg px-4 py-3 text-sm text-white shadow-xl flex items-center gap-3 animate-pulse`}>
          {n.type === "success" && <CheckCircle size={16} className="text-emerald-400 shrink-0" />}
          {n.type === "liquidation" && <AlertTriangle size={16} className="text-red-400 shrink-0" />}
          {n.type === "warning" && <AlertTriangle size={16} className="text-amber-400 shrink-0" />}
          {n.type === "info" && <Activity size={16} className="text-blue-400 shrink-0" />}
          <span className="flex-1">{n.message}</span>
          <button onClick={() => dispatch({ type: "DISMISS_NOTIFICATION", payload: n.id })} className="text-slate-400 hover:text-white"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
});

// --- Market Sidebar ---
const MarketSidebar = memo(({ markets, selectedSymbol, dispatch }) => {
  const [search, setSearch] = useState("");
  const [favs, setFavs] = useState(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
  const [showFavs, setShowFavs] = useState(false);

  const filtered = SYMBOLS.filter((s) => {
    if (search && !s.base.toLowerCase().includes(search.toLowerCase()) && !s.symbol.toLowerCase().includes(search.toLowerCase())) return false;
    if (showFavs && !favs.includes(s.symbol)) return false;
    return true;
  });

  return (
    <div className="w-64 shrink-0 bg-slate-900 border-r border-slate-700/50 flex flex-col h-full">
      <div className="p-3 border-b border-slate-700/50">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search markets" className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-yellow-500/50" />
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={() => setShowFavs(false)} className={`text-xs px-3 py-1 rounded ${!showFavs ? "bg-yellow-500/20 text-yellow-400" : "text-slate-400 hover:text-white"}`}>All</button>
          <button onClick={() => setShowFavs(true)} className={`text-xs px-3 py-1 rounded flex items-center gap-1 ${showFavs ? "bg-yellow-500/20 text-yellow-400" : "text-slate-400 hover:text-white"}`}><Star size={10} /> Favorites</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-3 px-3 py-2 text-xs text-slate-500 border-b border-slate-800">
          <span>Pair</span><span className="text-right">Price</span><span className="text-right">24h</span>
        </div>
        {filtered.map((s) => {
          const m = markets[s.symbol] || {};
          const selected = s.symbol === selectedSymbol;
          return (
            <div key={s.symbol} onClick={() => dispatch({ type: "SELECT_SYMBOL", payload: s.symbol })} className={`grid grid-cols-3 items-center px-3 py-2.5 cursor-pointer transition-colors ${selected ? "bg-slate-800/80 border-l-2 border-yellow-500" : "hover:bg-slate-800/40 border-l-2 border-transparent"}`}>
              <div className="flex items-center gap-2">
                <button onClick={(e) => { e.stopPropagation(); setFavs((f) => f.includes(s.symbol) ? f.filter((x) => x !== s.symbol) : [...f, s.symbol]); }} className={`${favs.includes(s.symbol) ? "text-yellow-400" : "text-slate-600"}`}><Star size={10} fill={favs.includes(s.symbol) ? "currentColor" : "none"} /></button>
                <div>
                  <span className="text-white text-sm font-medium">{s.base}</span>
                  <span className="text-slate-500 text-xs">/{s.quote}</span>
                </div>
              </div>
              <span className="text-right text-sm text-white font-mono">{m.price ? fmt(m.price, s.decimals) : "—"}</span>
              <span className={`text-right text-xs font-mono ${m.changePercent > 0 ? "text-emerald-400" : m.changePercent < 0 ? "text-red-400" : "text-slate-400"}`}>{m.changePercent ? fmtPct(m.changePercent) : "—"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// --- Header Bar ---
const HeaderBar = memo(({ state, dispatch }) => {
  const totalUnrealized = state.positions.reduce((s, p) => s + (p.unrealizedPnL || 0), 0);
  const totalEquity = state.balance + totalUnrealized + Object.entries(state.balances).reduce((s, [k, v]) => {
    if (k === "USDT") return s;
    return s + v * (state.markets[k + "USDT"]?.price || 0);
  }, 0);
  const totalPnL = totalEquity - state.startingBalance;
  const wsCount = Object.values(state.wsConnected).filter(Boolean).length;

  return (
    <div className="h-14 bg-slate-900 border-b border-slate-700/50 flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-yellow-500 flex items-center justify-center"><Zap size={18} className="text-black" /></div>
          <span className="text-white font-bold text-lg">PayTrade<span className="text-yellow-400">Pro</span></span>
        </div>
        <div className="h-6 w-px bg-slate-700 mx-2" />
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${wsCount > 0 ? "bg-emerald-400" : "bg-red-400"} animate-pulse`} />
          <span className="text-xs text-slate-400">{wsCount}/{SYMBOLS.length} Live</span>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="text-right">
          <div className="text-xs text-slate-500">Total Equity</div>
          <div className="text-white font-bold font-mono">{fmtUSD(totalEquity)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Available</div>
          <div className="text-white font-mono text-sm">{fmtUSD(state.balance)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Total P&L</div>
          <div className={`font-bold font-mono ${pnlColor(totalPnL)}`}>{totalPnL >= 0 ? "+" : ""}{fmtUSD(totalPnL)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Unrealized</div>
          <div className={`font-mono text-sm ${pnlColor(totalUnrealized)}`}>{totalUnrealized >= 0 ? "+" : ""}{fmtUSD(totalUnrealized)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Positions</div>
          <div className="text-white font-mono text-sm">{state.positions.length}</div>
        </div>
        <button onClick={() => { if (confirm(`Reset your paper trading account to ${fmtUSD(state.startingBalance)}? All positions and history will be cleared.`)) dispatch({ type: "RESET_ACCOUNT" }); }} className="text-xs text-slate-500 hover:text-yellow-400 flex items-center gap-1 px-2 py-1 rounded border border-slate-700 hover:border-yellow-500/50 transition-colors"><RefreshCw size={12} /> Reset</button>
      </div>
    </div>
  );
});

// --- Tab Bar ---
const TabBar = memo(({ activeTab, dispatch, positions }) => {
  const tabs = [
    { id: "spot", label: "Spot", icon: ArrowUpDown },
    { id: "futures", label: "Futures", icon: Zap, badge: positions.length },
    { id: "portfolio", label: "Portfolio", icon: Wallet },
    { id: "history", label: "History", icon: Clock },
  ];
  return (
    <div className="flex border-b border-slate-700/50 bg-slate-900/50 px-4">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => dispatch({ type: "SET_TAB", payload: t.id })} className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === t.id ? "border-yellow-500 text-yellow-400" : "border-transparent text-slate-400 hover:text-white hover:border-slate-600"}`}>
          <t.icon size={16} />
          {t.label}
          {t.badge > 0 && <span className="bg-yellow-500/20 text-yellow-400 text-xs px-1.5 py-0.5 rounded-full">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
});

// --- Price Chart ---
const PriceChart = memo(({ klines, symbol, timeframe }) => {
  const cfg = getSymbolConfig(symbol);
  const data = klines[`${symbol}_${timeframe}`] || [];
  if (data.length === 0) return <div className="flex-1 flex items-center justify-center text-slate-500">Loading chart data...</div>;

  const minPrice = Math.min(...data.map((d) => d.low)) * 0.999;
  const maxPrice = Math.max(...data.map((d) => d.high)) * 1.001;
  const isUp = data.length > 1 && data[data.length - 1].close >= data[data.length - 2].close;

  return (
    <div className="flex-1 min-h-0">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="time" tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#334155" }} tickLine={false} minTickGap={40} />
          <YAxis domain={[minPrice, maxPrice]} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#334155" }} tickLine={false} tickFormatter={(v) => fmt(v, cfg.decimals)} width={80} orientation="right" />
          <RTooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} labelFormatter={(t) => new Date(t).toLocaleString()} formatter={(v) => [fmt(v, cfg.decimals), ""]} />
          <Area type="monotone" dataKey="close" stroke={isUp ? "#10b981" : "#ef4444"} fill={isUp ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)"} strokeWidth={2} dot={false} />
          <Bar dataKey="volume" fill="rgba(100,116,139,0.15)" yAxisId="volume" barSize={4} />
          <YAxis yAxisId="volume" orientation="left" hide domain={[0, (max) => max * 5]} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

// --- Order Book ---
const OrderBook = memo(({ orderBook, symbol, price }) => {
  const cfg = getSymbolConfig(symbol);
  const book = orderBook || { bids: [], asks: [] };
  const maxQty = Math.max(
    ...book.bids.map(([, q]) => q), ...book.asks.map(([, q]) => q), 0.001
  );

  return (
    <div className="flex flex-col h-full">
      <div className="text-xs text-slate-500 grid grid-cols-3 px-3 py-1.5 border-b border-slate-700/30">
        <span>Price ({cfg.quote})</span><span className="text-right">Amount ({cfg.base})</span><span className="text-right">Total</span>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden flex flex-col justify-end">
          {book.asks.slice(0, 10).reverse().map(([p, q], i) => (
            <div key={`a${i}`} className="grid grid-cols-3 px-3 py-0.5 text-xs font-mono relative">
              <div className="absolute inset-0 bg-red-500/5" style={{ width: `${(q / maxQty) * 100}%`, right: 0, left: "auto" }} />
              <span className="text-red-400 relative z-10">{fmt(p, cfg.decimals)}</span>
              <span className="text-right text-slate-300 relative z-10">{fmtQty(q, 4)}</span>
              <span className="text-right text-slate-500 relative z-10">{fmt(p * q, 2)}</span>
            </div>
          ))}
        </div>
        <div className="py-2 px-3 border-y border-slate-700/30 bg-slate-800/50">
          <span className={`text-lg font-bold font-mono ${price && book.bids[0] && price >= book.bids[0][0] ? "text-emerald-400" : "text-red-400"}`}>
            {price ? fmt(price, cfg.decimals) : "—"}
          </span>
          <span className="text-slate-500 text-xs ml-2">≈ {price ? fmtUSD(price) : "—"}</span>
        </div>
        <div className="flex-1 overflow-hidden">
          {book.bids.slice(0, 10).map(([p, q], i) => (
            <div key={`b${i}`} className="grid grid-cols-3 px-3 py-0.5 text-xs font-mono relative">
              <div className="absolute inset-0 bg-emerald-500/5" style={{ width: `${(q / maxQty) * 100}%`, right: 0, left: "auto" }} />
              <span className="text-emerald-400 relative z-10">{fmt(p, cfg.decimals)}</span>
              <span className="text-right text-slate-300 relative z-10">{fmtQty(q, 4)}</span>
              <span className="text-right text-slate-500 relative z-10">{fmt(p * q, 2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// --- Spot Order Form ---
const SpotOrderForm = memo(({ symbol, price, balances, dispatch }) => {
  const cfg = getSymbolConfig(symbol);
  const [side, setSide] = useState("BUY");
  const [orderType, setOrderType] = useState("MARKET");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [pctBtns] = useState([25, 50, 75, 100]);

  const available = side === "BUY" ? (balances.USDT || 0) : (balances[cfg.base] || 0);
  const effPrice = orderType === "LIMIT" ? parseFloat(limitPrice) || 0 : price || 0;
  const qty = parseFloat(quantity) || 0;
  const total = qty * effPrice;
  const fee = total * SPOT_FEE;

  const handleSubmit = () => {
    if (!qty || !effPrice) return;
    if (orderType === "MARKET") {
      dispatch({ type: side === "BUY" ? "SPOT_BUY" : "SPOT_SELL", payload: { symbol, quantity: qty, price: effPrice } });
    } else {
      dispatch({ type: "SPOT_LIMIT_ORDER", payload: { symbol, side, quantity: qty, price: effPrice } });
    }
    setQuantity("");
  };

  const handlePct = (pct) => {
    if (side === "BUY" && effPrice > 0) setQuantity(((available * (pct / 100)) / effPrice / (1 + SPOT_FEE)).toFixed(8));
    else if (side === "SELL") setQuantity((available * (pct / 100)).toFixed(8));
  };

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-1 bg-slate-800 p-1 rounded-lg">
        <button onClick={() => setSide("BUY")} className={`py-2 text-sm font-semibold rounded-md transition-colors ${side === "BUY" ? "bg-emerald-500 text-white" : "text-slate-400 hover:text-white"}`}>Buy</button>
        <button onClick={() => setSide("SELL")} className={`py-2 text-sm font-semibold rounded-md transition-colors ${side === "SELL" ? "bg-red-500 text-white" : "text-slate-400 hover:text-white"}`}>Sell</button>
      </div>
      <div className="flex gap-2">
        {["MARKET", "LIMIT"].map((t) => (
          <button key={t} onClick={() => setOrderType(t)} className={`text-xs px-3 py-1.5 rounded ${orderType === t ? "bg-slate-700 text-white" : "text-slate-500 hover:text-white"}`}>{t}</button>
        ))}
      </div>
      <div className="text-xs text-slate-500 flex justify-between">
        <span>Available</span>
        <span className="text-white font-mono">{side === "BUY" ? fmtUSD(available) : `${fmtQty(available, 8)} ${cfg.base}`}</span>
      </div>
      {orderType === "LIMIT" && (
        <div>
          <label className="text-xs text-slate-500 mb-1 block">Price</label>
          <div className="relative">
            <input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="0.00" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-yellow-500/50" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{cfg.quote}</span>
          </div>
        </div>
      )}
      <div>
        <label className="text-xs text-slate-500 mb-1 block">Amount</label>
        <div className="relative">
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0.00" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-yellow-500/50" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{cfg.base}</span>
        </div>
      </div>
      <div className="flex gap-1">
        {pctBtns.map((p) => (
          <button key={p} onClick={() => handlePct(p)} className="flex-1 text-xs py-1 bg-slate-800 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors">{p}%</button>
        ))}
      </div>
      <div className="text-xs text-slate-500 space-y-1">
        <div className="flex justify-between"><span>Total</span><span className="text-white font-mono">{fmtUSD(total)}</span></div>
        <div className="flex justify-between"><span>Fee (0.1%)</span><span className="text-slate-400 font-mono">{fmtUSD(fee)}</span></div>
      </div>
      <button onClick={handleSubmit} disabled={!qty || !effPrice} className={`w-full py-3 rounded-lg font-semibold text-sm transition-colors ${side === "BUY" ? "bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/30" : "bg-red-500 hover:bg-red-600 disabled:bg-red-500/30"} text-white disabled:text-white/50`}>
        {side === "BUY" ? "Buy" : "Sell"} {cfg.base}
      </button>
    </div>
  );
});

// --- Futures Order Form ---
const FuturesOrderForm = memo(({ symbol, price, balance, dispatch }) => {
  const cfg = getSymbolConfig(symbol);
  const [side, setSide] = useState("LONG");
  const [leverage, setLeverage] = useState(10);
  const [quantity, setQuantity] = useState("");
  const [showLeverage, setShowLeverage] = useState(false);

  const qty = parseFloat(quantity) || 0;
  const margin = qty > 0 && price ? calcMarginRequired(qty, price, leverage) : 0;
  const fee = qty * (price || 0) * FUTURES_FEE;
  const liqPrice = qty > 0 && price ? calcLiqPrice(price, leverage, side) : 0;
  const maxQty = price > 0 ? (balance * leverage * 0.99) / price : 0;

  const handleSubmit = () => {
    if (!qty || !price) return;
    dispatch({ type: "OPEN_POSITION", payload: { symbol, side, quantity: qty, price, leverage } });
    setQuantity("");
  };

  const handlePct = (pct) => {
    if (price > 0) setQuantity((maxQty * (pct / 100)).toFixed(8));
  };

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-1 bg-slate-800 p-1 rounded-lg">
        <button onClick={() => setSide("LONG")} className={`py-2 text-sm font-semibold rounded-md transition-colors ${side === "LONG" ? "bg-emerald-500 text-white" : "text-slate-400 hover:text-white"}`}>Long</button>
        <button onClick={() => setSide("SHORT")} className={`py-2 text-sm font-semibold rounded-md transition-colors ${side === "SHORT" ? "bg-red-500 text-white" : "text-slate-400 hover:text-white"}`}>Short</button>
      </div>

      <div>
        <button onClick={() => setShowLeverage(!showLeverage)} className="w-full flex items-center justify-between bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm hover:border-yellow-500/50 transition-colors">
          <span className="text-slate-400">Leverage</span>
          <span className="text-yellow-400 font-bold">{leverage}x</span>
        </button>
        {showLeverage && (
          <div className="mt-2 bg-slate-800 border border-slate-700 rounded-lg p-3">
            <input type="range" min={1} max={125} value={leverage} onChange={(e) => setLeverage(parseInt(e.target.value))} className="w-full accent-yellow-500" />
            <div className="flex flex-wrap gap-1 mt-2">
              {LEVERAGE_PRESETS.map((l) => (
                <button key={l} onClick={() => { setLeverage(l); setShowLeverage(false); }} className={`text-xs px-2 py-1 rounded ${leverage === l ? "bg-yellow-500/20 text-yellow-400" : "bg-slate-700 text-slate-400 hover:text-white"}`}>{l}x</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-slate-500 flex justify-between">
        <span>Available Margin</span>
        <span className="text-white font-mono">{fmtUSD(balance)}</span>
      </div>

      <div>
        <label className="text-xs text-slate-500 mb-1 block">Size ({cfg.base})</label>
        <div className="relative">
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0.00" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-yellow-500/50" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">{cfg.base}</span>
        </div>
      </div>

      <div className="flex gap-1">
        {[25, 50, 75, 100].map((p) => (
          <button key={p} onClick={() => handlePct(p)} className="flex-1 text-xs py-1 bg-slate-800 rounded text-slate-400 hover:text-white hover:bg-slate-700">{p}%</button>
        ))}
      </div>

      <div className="bg-slate-800/50 rounded-lg p-3 space-y-2 text-xs">
        <div className="flex justify-between"><span className="text-slate-500">Margin Required</span><span className="text-white font-mono">{fmtUSD(margin)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Position Value</span><span className="text-white font-mono">{fmtUSD(qty * (price || 0))}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Fee (0.02%)</span><span className="text-slate-400 font-mono">{fmtUSD(fee)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">Est. Liquidation</span><span className="text-amber-400 font-mono">{liqPrice > 0 ? fmtUSD(liqPrice) : "—"}</span></div>
      </div>

      <button onClick={handleSubmit} disabled={!qty || !price || margin + fee > balance} className={`w-full py-3 rounded-lg font-semibold text-sm transition-colors ${side === "LONG" ? "bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/30" : "bg-red-500 hover:bg-red-600 disabled:bg-red-500/30"} text-white disabled:text-white/50`}>
        Open {side} {leverage}x
      </button>
    </div>
  );
});

// --- Positions Table ---
const PositionsTable = memo(({ positions, markets, dispatch }) => {
  if (positions.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
      <Target size={40} className="mb-3 text-slate-600" />
      <p className="text-sm">No open positions</p>
      <p className="text-xs mt-1">Open a position to start trading</p>
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-slate-700/50">
            <th className="text-left py-2 px-3 font-normal">Symbol</th>
            <th className="text-left py-2 px-3 font-normal">Side</th>
            <th className="text-right py-2 px-3 font-normal">Size</th>
            <th className="text-right py-2 px-3 font-normal">Entry</th>
            <th className="text-right py-2 px-3 font-normal">Mark</th>
            <th className="text-right py-2 px-3 font-normal">Liq. Price</th>
            <th className="text-right py-2 px-3 font-normal">Margin</th>
            <th className="text-right py-2 px-3 font-normal">PnL (ROE%)</th>
            <th className="text-center py-2 px-3 font-normal">Action</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const cfg = getSymbolConfig(pos.symbol);
            const pnl = pos.unrealizedPnL || 0;
            const roe = pos.roe || 0;
            const marginRatio = Math.abs(pnl) / pos.margin;
            const danger = marginRatio > 0.7 && pnl < 0;
            return (
              <tr key={pos.id} className={`border-b border-slate-800 hover:bg-slate-800/30 ${danger ? "bg-red-500/5" : ""}`}>
                <td className="py-3 px-3">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{cfg.base}<span className="text-slate-500">/{cfg.quote}</span></span>
                    <span className="text-yellow-400 text-xs bg-yellow-500/10 px-1.5 py-0.5 rounded">{pos.leverage}x</span>
                  </div>
                </td>
                <td className="py-3 px-3"><span className={`font-semibold ${pos.side === "LONG" ? "text-emerald-400" : "text-red-400"}`}>{pos.side}</span></td>
                <td className="py-3 px-3 text-right text-white font-mono">{fmtQty(pos.quantity, 4)}</td>
                <td className="py-3 px-3 text-right text-white font-mono">{fmt(pos.entryPrice, cfg.decimals)}</td>
                <td className="py-3 px-3 text-right text-white font-mono">{fmt(pos.markPrice, cfg.decimals)}</td>
                <td className="py-3 px-3 text-right"><span className={`font-mono ${danger ? "text-red-400 animate-pulse" : "text-amber-400"}`}>{fmt(pos.liquidationPrice, cfg.decimals)}</span></td>
                <td className="py-3 px-3 text-right text-white font-mono">{fmtUSD(pos.margin)}</td>
                <td className="py-3 px-3 text-right">
                  <span className={`font-mono font-semibold ${pnlColor(pnl)}`}>{pnl >= 0 ? "+" : ""}{fmtUSD(pnl)}</span>
                  <span className={`block text-xs ${pnlColor(roe)}`}>({fmtPct(roe)})</span>
                </td>
                <td className="py-3 px-3 text-center">
                  <button onClick={() => dispatch({ type: "CLOSE_POSITION", payload: { id: pos.id } })} className="text-xs px-3 py-1.5 bg-slate-700 hover:bg-red-500/20 hover:text-red-400 text-slate-300 rounded transition-colors">Close</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

// --- Trade History ---
const TradeHistoryTable = memo(({ trades }) => {
  if (trades.length === 0) return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-500">
      <Clock size={40} className="mb-3 text-slate-600" />
      <p className="text-sm">No trades yet</p>
      <p className="text-xs mt-1">Your completed trades will appear here</p>
    </div>
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-slate-700/50">
            <th className="text-left py-2 px-3 font-normal">Time</th>
            <th className="text-left py-2 px-3 font-normal">Symbol</th>
            <th className="text-left py-2 px-3 font-normal">Type</th>
            <th className="text-left py-2 px-3 font-normal">Side</th>
            <th className="text-right py-2 px-3 font-normal">Quantity</th>
            <th className="text-right py-2 px-3 font-normal">Entry</th>
            <th className="text-right py-2 px-3 font-normal">Exit</th>
            <th className="text-right py-2 px-3 font-normal">PnL</th>
          </tr>
        </thead>
        <tbody>
          {trades.slice(0, 50).map((t) => {
            const cfg = getSymbolConfig(t.symbol);
            return (
              <tr key={t.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                <td className="py-2.5 px-3 text-slate-400">{new Date(t.closedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="py-2.5 px-3 text-white font-medium">{cfg.base}<span className="text-slate-500">/{cfg.quote}</span>{t.leverage && <span className="text-yellow-400 text-xs ml-1">{t.leverage}x</span>}</td>
                <td className="py-2.5 px-3"><span className={`px-1.5 py-0.5 rounded text-xs ${t.type === "LIQUIDATION" ? "bg-red-500/20 text-red-400" : t.type === "FUTURES" ? "bg-yellow-500/10 text-yellow-400" : "bg-slate-700 text-slate-300"}`}>{t.type}</span></td>
                <td className="py-2.5 px-3"><span className={t.side === "LONG" || t.side === "BUY" ? "text-emerald-400" : "text-red-400"}>{t.side}</span></td>
                <td className="py-2.5 px-3 text-right text-white font-mono">{fmtQty(t.quantity, 4)}</td>
                <td className="py-2.5 px-3 text-right text-white font-mono">{t.entryPrice ? fmt(t.entryPrice, cfg.decimals) : fmt(t.price, cfg.decimals)}</td>
                <td className="py-2.5 px-3 text-right text-white font-mono">{t.exitPrice ? fmt(t.exitPrice, cfg.decimals) : "—"}</td>
                <td className={`py-2.5 px-3 text-right font-mono font-semibold ${pnlColor(t.pnl)}`}>{t.pnl >= 0 ? "+" : ""}{fmtUSD(t.pnl)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

// --- Portfolio Dashboard ---
const PortfolioDashboard = memo(({ state }) => {
  const totalUnrealized = state.positions.reduce((s, p) => s + (p.unrealizedPnL || 0), 0);
  const spotValue = Object.entries(state.balances).reduce((s, [k, v]) => {
    if (k === "USDT") return s;
    return s + v * (state.markets[k + "USDT"]?.price || 0);
  }, 0);
  const totalEquity = state.balance + totalUnrealized + spotValue;
  const marginUsed = state.positions.reduce((s, p) => s + p.margin, 0);
  const totalTrades = state.tradeHistory.filter((t) => t.type === "FUTURES").length;
  const winTrades = state.tradeHistory.filter((t) => t.type === "FUTURES" && t.pnl > 0).length;
  const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;

  const pnlHistory = state.tradeHistory.filter((t) => t.pnl !== undefined).slice(0, 30).reverse().map((t, i) => ({
    trade: i + 1,
    pnl: t.pnl,
    cumulative: state.tradeHistory.filter((t2) => t2.pnl !== undefined).slice(0, 30).reverse().slice(0, i + 1).reduce((s, x) => s + x.pnl, 0),
  }));

  const holdings = Object.entries(state.balances).filter(([k, v]) => v > 0.00000001).map(([k, v]) => ({
    name: k, value: k === "USDT" ? v : v * (state.markets[k + "USDT"]?.price || 0),
  }));
  const COLORS = ["#eab308", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#f43e5e"];

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Equity", value: fmtUSD(totalEquity), sub: `${fmtPct(((totalEquity - state.startingBalance) / state.startingBalance) * 100)} all time`, color: pnlColor(totalEquity - state.startingBalance), icon: Wallet },
          { label: "Available Balance", value: fmtUSD(state.balance), sub: `${fmtUSD(marginUsed)} in margin`, color: "text-white", icon: DollarSign },
          { label: "Unrealized P&L", value: `${totalUnrealized >= 0 ? "+" : ""}${fmtUSD(totalUnrealized)}`, sub: `${state.positions.length} open positions`, color: pnlColor(totalUnrealized), icon: TrendingUp },
          { label: "Realized P&L", value: `${state.totalRealizedPnL >= 0 ? "+" : ""}${fmtUSD(state.totalRealizedPnL)}`, sub: `Win rate: ${fmt(winRate, 1)}%`, color: pnlColor(state.totalRealizedPnL), icon: BarChart3 },
        ].map((card, i) => (
          <div key={i} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <card.icon size={16} className="text-slate-500" />
              <span className="text-xs text-slate-500">{card.label}</span>
            </div>
            <div className={`text-xl font-bold font-mono ${card.color}`}>{card.value}</div>
            <div className="text-xs text-slate-500 mt-1">{card.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm text-slate-400 mb-3">Cumulative P&L</h3>
          {pnlHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={pnlHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="trade" tick={{ fill: "#64748b", fontSize: 10 }} />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                <RTooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmtUSD(v), ""]} />
                <Area type="monotone" dataKey="cumulative" stroke="#eab308" fill="rgba(234,179,8,0.1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-48 text-slate-500 text-sm">Complete trades to see your P&L curve</div>}
        </div>

        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm text-slate-400 mb-3">Asset Allocation</h3>
          {holdings.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={holdings} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} innerRadius={40} strokeWidth={0}>
                  {holdings.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <RTooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmtUSD(v), ""]} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-48 text-slate-500 text-sm">No holdings</div>}
        </div>
      </div>

      {state.positions.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <h3 className="text-sm text-slate-400 mb-3">Open Positions</h3>
          <PositionsTable positions={state.positions} markets={state.markets} dispatch={() => {}} />
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
        <h3 className="text-sm text-slate-400 mb-3">Spot Holdings</h3>
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(state.balances).filter(([, v]) => v > 0.001).map(([k, v]) => {
            const usdVal = k === "USDT" ? v : v * (state.markets[k + "USDT"]?.price || 0);
            return (
              <div key={k} className="flex items-center justify-between bg-slate-900/50 rounded-lg p-3">
                <div>
                  <span className="text-white font-medium text-sm">{k}</span>
                  <span className="text-slate-500 text-xs ml-2 font-mono">{k === "USDT" ? fmt(v, 2) : fmtQty(v, 6)}</span>
                </div>
                <span className="text-white font-mono text-sm">{fmtUSD(usdVal)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// MAIN TRADING TABS
// ═══════════════════════════════════════════════════════════════════

const SpotTab = memo(({ state, dispatch, fetchOrderBook, fetchKlines }) => {
  const sym = state.selectedSymbol;
  const cfg = getSymbolConfig(sym);
  const market = state.markets[sym] || {};

  useEffect(() => {
    fetchOrderBook(sym);
    fetchKlines(sym, state.timeframe);
    const iv = setInterval(() => fetchOrderBook(sym), 5000);
    return () => clearInterval(iv);
  }, [sym, state.timeframe]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Symbol info bar */}
      <div className="flex items-center gap-6 px-4 py-3 border-b border-slate-700/50 bg-slate-900/30">
        <div>
          <span className="text-white text-lg font-bold">{cfg.base}</span>
          <span className="text-slate-500">/{cfg.quote}</span>
        </div>
        <div className="text-2xl font-bold font-mono text-white">{market.price ? fmt(market.price, cfg.decimals) : "—"}</div>
        <div className={`text-sm font-mono ${pnlColor(market.changePercent)}`}>{market.changePercent ? fmtPct(market.changePercent) : "—"}</div>
        <div className="flex gap-6 text-xs text-slate-500 ml-auto">
          <div><span className="block text-slate-600">24h High</span><span className="text-white font-mono">{market.high24h ? fmt(market.high24h, cfg.decimals) : "—"}</span></div>
          <div><span className="block text-slate-600">24h Low</span><span className="text-white font-mono">{market.low24h ? fmt(market.low24h, cfg.decimals) : "—"}</span></div>
          <div><span className="block text-slate-600">24h Volume</span><span className="text-white font-mono">{market.volume24h ? `$${fmt(market.volume24h / 1e6, 1)}M` : "—"}</span></div>
        </div>
      </div>

      {/* Timeframe selector */}
      <div className="flex gap-1 px-4 py-2 border-b border-slate-700/30">
        {TIMEFRAMES.map((tf) => (
          <button key={tf} onClick={() => { dispatch({ type: "SET_TIMEFRAME", payload: tf }); fetchKlines(sym, tf); }} className={`text-xs px-3 py-1 rounded ${state.timeframe === tf ? "bg-yellow-500/20 text-yellow-400" : "text-slate-500 hover:text-white"}`}>{tf}</button>
        ))}
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Chart */}
        <div className="flex-1 flex flex-col min-w-0 p-2">
          <PriceChart klines={state.klines} symbol={sym} timeframe={state.timeframe} />
        </div>
        {/* Order book */}
        <div className="w-64 border-l border-slate-700/50 shrink-0">
          <div className="px-3 py-2 text-xs text-slate-400 font-medium border-b border-slate-700/30">Order Book</div>
          <OrderBook orderBook={state.orderBooks[sym]} symbol={sym} price={market.price} />
        </div>
        {/* Order form */}
        <div className="w-72 border-l border-slate-700/50 shrink-0 overflow-y-auto">
          <div className="px-3 py-2 text-xs text-slate-400 font-medium border-b border-slate-700/30">Place Order</div>
          <SpotOrderForm symbol={sym} price={market.price} balances={state.balances} dispatch={dispatch} />
        </div>
      </div>

      {/* Open orders */}
      {state.spotOrders.filter((o) => o.status === "OPEN").length > 0 && (
        <div className="border-t border-slate-700/50 max-h-48 overflow-y-auto">
          <div className="px-4 py-2 text-xs text-slate-400 font-medium">Open Orders</div>
          <table className="w-full text-xs">
            <tbody>
              {state.spotOrders.filter((o) => o.status === "OPEN").map((o) => (
                <tr key={o.id} className="border-t border-slate-800">
                  <td className="py-2 px-4 text-white">{getSymbolConfig(o.symbol).base}/{getSymbolConfig(o.symbol).quote}</td>
                  <td className={`py-2 ${o.side === "BUY" ? "text-emerald-400" : "text-red-400"}`}>{o.type} {o.side}</td>
                  <td className="py-2 text-white font-mono text-right">{fmtQty(o.quantity, 4)}</td>
                  <td className="py-2 text-white font-mono text-right">{fmtUSD(o.price)}</td>
                  <td className="py-2 text-right"><button onClick={() => dispatch({ type: "CANCEL_SPOT_ORDER", payload: o.id })} className="text-red-400 hover:text-red-300"><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});

const FuturesTab = memo(({ state, dispatch, fetchOrderBook, fetchKlines }) => {
  const sym = state.selectedSymbol;
  const cfg = getSymbolConfig(sym);
  const market = state.markets[sym] || {};

  useEffect(() => {
    fetchOrderBook(sym);
    fetchKlines(sym, state.timeframe);
    const iv = setInterval(() => fetchOrderBook(sym), 5000);
    return () => clearInterval(iv);
  }, [sym, state.timeframe]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-6 px-4 py-3 border-b border-slate-700/50 bg-slate-900/30">
        <div>
          <span className="text-white text-lg font-bold">{cfg.base}</span>
          <span className="text-slate-500">USDT Perpetual</span>
        </div>
        <div className="text-2xl font-bold font-mono text-white">{market.price ? fmt(market.price, cfg.decimals) : "—"}</div>
        <div className={`text-sm font-mono ${pnlColor(market.changePercent)}`}>{market.changePercent ? fmtPct(market.changePercent) : "—"}</div>
        <div className="flex gap-4 text-xs text-slate-500 ml-auto">
          <div><span className="block text-slate-600">Mark Price</span><span className="text-white font-mono">{market.price ? fmt(market.price, cfg.decimals) : "—"}</span></div>
          <div><span className="block text-slate-600">Funding Rate</span><span className="text-emerald-400 font-mono">0.0100%</span></div>
          <div><span className="block text-slate-600">24h Volume</span><span className="text-white font-mono">{market.volume24h ? `$${fmt(market.volume24h / 1e6, 1)}M` : "—"}</span></div>
        </div>
      </div>

      <div className="flex gap-1 px-4 py-2 border-b border-slate-700/30">
        {TIMEFRAMES.map((tf) => (
          <button key={tf} onClick={() => { dispatch({ type: "SET_TIMEFRAME", payload: tf }); fetchKlines(sym, tf); }} className={`text-xs px-3 py-1 rounded ${state.timeframe === tf ? "bg-yellow-500/20 text-yellow-400" : "text-slate-500 hover:text-white"}`}>{tf}</button>
        ))}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0 p-2">
          <PriceChart klines={state.klines} symbol={sym} timeframe={state.timeframe} />
        </div>
        <div className="w-64 border-l border-slate-700/50 shrink-0">
          <div className="px-3 py-2 text-xs text-slate-400 font-medium border-b border-slate-700/30">Order Book</div>
          <OrderBook orderBook={state.orderBooks[sym]} symbol={sym} price={market.price} />
        </div>
        <div className="w-72 border-l border-slate-700/50 shrink-0 overflow-y-auto">
          <div className="px-3 py-2 text-xs text-slate-400 font-medium border-b border-slate-700/30">Open Position</div>
          <FuturesOrderForm symbol={sym} price={market.price} balance={state.balance} dispatch={dispatch} />
        </div>
      </div>

      {/* Positions panel */}
      <div className="border-t border-slate-700/50 max-h-64 overflow-y-auto">
        <div className="px-4 py-2 text-xs text-slate-400 font-medium flex items-center gap-2">
          Positions <span className="bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">{state.positions.length}</span>
        </div>
        <PositionsTable positions={state.positions} markets={state.markets} dispatch={dispatch} />
      </div>
    </div>
  );
});

const HistoryTab = memo(({ state }) => {
  const [filter, setFilter] = useState("ALL");
  const trades = state.tradeHistory.filter((t) => {
    if (filter === "ALL") return true;
    if (filter === "SPOT") return t.type === "MARKET" || t.side === "BUY" || t.side === "SELL";
    if (filter === "FUTURES") return t.type === "FUTURES" || t.type === "LIQUIDATION";
    return true;
  });

  const stats = useMemo(() => {
    const futures = state.tradeHistory.filter((t) => t.type === "FUTURES" || t.type === "LIQUIDATION");
    const wins = futures.filter((t) => t.pnl > 0);
    const losses = futures.filter((t) => t.pnl < 0);
    const totalPnL = futures.reduce((s, t) => s + t.pnl, 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const biggestWin = wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : 0;
    const biggestLoss = losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : 0;
    return {
      total: futures.length, wins: wins.length, losses: losses.length,
      winRate: futures.length > 0 ? (wins.length / futures.length) * 100 : 0,
      totalPnL, avgWin, avgLoss, biggestWin, biggestLoss,
      profitFactor: Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : 0,
    };
  }, [state.tradeHistory]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-5 gap-4">
          {[
            { label: "Total Trades", value: stats.total, color: "text-white" },
            { label: "Win Rate", value: `${fmt(stats.winRate, 1)}%`, color: stats.winRate >= 50 ? "text-emerald-400" : "text-red-400" },
            { label: "Avg Win", value: fmtUSD(stats.avgWin), color: "text-emerald-400" },
            { label: "Avg Loss", value: fmtUSD(stats.avgLoss), color: "text-red-400" },
            { label: "Profit Factor", value: fmt(stats.profitFactor, 2), color: stats.profitFactor >= 1 ? "text-emerald-400" : "text-red-400" },
          ].map((s, i) => (
            <div key={i} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 text-center">
              <div className="text-xs text-slate-500 mb-1">{s.label}</div>
              <div className={`text-xl font-bold font-mono ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm text-slate-400">Trade History</h3>
            <div className="flex gap-1">
              {["ALL", "SPOT", "FUTURES"].map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`text-xs px-3 py-1 rounded ${filter === f ? "bg-yellow-500/20 text-yellow-400" : "text-slate-500 hover:text-white"}`}>{f}</button>
              ))}
            </div>
          </div>
          <TradeHistoryTable trades={trades} />
        </div>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// SETUP SCREEN
// ═══════════════════════════════════════════════════════════════════
const BALANCE_PRESETS = [10000, 50000, 100000, 250000, 500000, 1000000, 5000000, 10000000];

const SetupScreen = memo(({ onStart }) => {
  const [balance, setBalance] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(100000);

  const effectiveBalance = balance ? parseFloat(balance) : selectedPreset;
  const isValid = effectiveBalance >= 100 && effectiveBalance <= 100000000;

  const handleStart = () => {
    if (isValid) onStart(effectiveBalance);
  };

  return (
    <div className="h-screen w-full bg-slate-950 flex items-center justify-center" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-yellow-500 flex items-center justify-center"><Zap size={28} className="text-black" /></div>
            <span className="text-white font-bold text-3xl">PayTrade<span className="text-yellow-400">Pro</span></span>
          </div>
          <p className="text-slate-400 text-sm">Practice crypto trading with real-time market data. No risk, all the bells and whistles.</p>
        </div>

        <div className="bg-slate-900 border border-slate-700/50 rounded-2xl p-6 space-y-6">
          <div>
            <label className="text-sm text-slate-400 mb-3 block">Choose your starting capital</label>
            <div className="grid grid-cols-4 gap-2">
              {BALANCE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => { setSelectedPreset(preset); setBalance(""); }}
                  className={`py-2.5 px-2 rounded-lg text-sm font-mono transition-all ${
                    !balance && selectedPreset === preset
                      ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-400 border"
                      : "bg-slate-800 border border-slate-700 text-slate-300 hover:border-slate-600 hover:text-white"
                  }`}
                >
                  {preset >= 1000000 ? `$${preset / 1000000}M` : `$${(preset / 1000).toFixed(0)}K`}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm text-slate-400">Or enter a custom amount</span>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg font-mono">$</span>
              <input
                type="number"
                value={balance}
                onChange={(e) => { setBalance(e.target.value); setSelectedPreset(null); }}
                placeholder={fmt(selectedPreset, 0)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-3.5 text-lg text-white font-mono placeholder-slate-600 focus:outline-none focus:border-yellow-500/50 transition-colors"
              />
            </div>
            {balance && !isValid && (
              <p className="text-red-400 text-xs mt-2">Enter an amount between $100 and $100,000,000</p>
            )}
          </div>

          <div className="bg-slate-800/50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Starting Balance</span><span className="text-white font-mono font-semibold">{fmtUSD(effectiveBalance)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Markets</span><span className="text-white">{SYMBOLS.length} crypto pairs</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Features</span><span className="text-white">Spot, Futures (125x), Margin</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Price Data</span><span className="text-emerald-400">Live from Binance</span></div>
          </div>

          <button
            onClick={handleStart}
            disabled={!isValid}
            className="w-full py-4 rounded-xl font-bold text-base bg-yellow-500 hover:bg-yellow-400 text-black transition-colors disabled:bg-slate-700 disabled:text-slate-500"
          >
            Start Trading
          </button>
        </div>

        <p className="text-center text-xs text-slate-600 mt-4">Paper trading only — no real money involved</p>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// ROOT APP COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [started, setStarted] = useState(false);
  const [state, dispatch] = useReducer(reducer, createInitialState());
  const { fetchOrderBook, fetchKlines } = useBinanceData(dispatch, started);

  const handleStart = useCallback((balance) => {
    dispatch({ type: "SET_BALANCE", payload: balance });
    setStarted(true);
  }, []);

  // Match pending limit orders against price
  useEffect(() => {
    if (!started) return;
    state.spotOrders.forEach((order) => {
      if (order.status !== "OPEN") return;
      const market = state.markets[order.symbol];
      if (!market?.price) return;
      if (order.side === "BUY" && market.price <= order.price) {
        dispatch({ type: "SPOT_BUY", payload: { symbol: order.symbol, quantity: order.quantity, price: order.price } });
        dispatch({ type: "CANCEL_SPOT_ORDER", payload: order.id });
      } else if (order.side === "SELL" && market.price >= order.price) {
        dispatch({ type: "SPOT_SELL", payload: { symbol: order.symbol, quantity: order.quantity, price: order.price } });
        dispatch({ type: "CANCEL_SPOT_ORDER", payload: order.id });
      }
    });
  }, [state.markets, started]);

  // Auto-dismiss old notifications
  useEffect(() => {
    if (!started || state.notifications.length === 0) return;
    const timer = setTimeout(() => {
      dispatch({ type: "DISMISS_NOTIFICATION", payload: state.notifications[state.notifications.length - 1]?.id });
    }, 4000);
    return () => clearTimeout(timer);
  }, [state.notifications, started]);

  if (!started) return <SetupScreen onStart={handleStart} />;

  return (
    <div className="h-screen w-full bg-slate-950 text-white flex flex-col overflow-hidden" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <NotificationToast notifications={state.notifications} dispatch={dispatch} />
      <HeaderBar state={state} dispatch={dispatch} />
      <TabBar activeTab={state.activeTab} dispatch={dispatch} positions={state.positions} />
      <div className="flex-1 flex min-h-0">
        <MarketSidebar markets={state.markets} selectedSymbol={state.selectedSymbol} dispatch={dispatch} />
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {state.activeTab === "spot" && <SpotTab state={state} dispatch={dispatch} fetchOrderBook={fetchOrderBook} fetchKlines={fetchKlines} />}
          {state.activeTab === "futures" && <FuturesTab state={state} dispatch={dispatch} fetchOrderBook={fetchOrderBook} fetchKlines={fetchKlines} />}
          {state.activeTab === "portfolio" && <PortfolioDashboard state={state} />}
          {state.activeTab === "history" && <HistoryTab state={state} />}
        </div>
      </div>
    </div>
  );
}
