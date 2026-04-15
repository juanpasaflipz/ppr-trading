import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useApp } from '../App';
import { formatUSD, formatPercent, formatNumber, pnlColor } from '../lib/format';
import { Play, Clock, TrendingUp, AlertTriangle, FlaskConical } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

export default function Backtesting() {
  const { addToast } = useApp();
  const [strategies, setStrategies] = useState([]);
  const [results, setResults] = useState([]);
  const [selectedResult, setSelectedResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [showRealistic, setShowRealistic] = useState(false);

  const [form, setForm] = useState({
    strategyId: '',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
  });

  useEffect(() => {
    api.getBacktestStrategies().then(setStrategies).catch(() => {});
    api.getBacktestResults().then(setResults).catch(() => {});
  }, []);

  const runBacktest = async () => {
    if (!form.strategyId) {
      addToast('Select a strategy', 'warning');
      return;
    }
    setRunning(true);
    try {
      const result = await api.runBacktest(form);
      setSelectedResult(result);
      addToast(`Backtest complete: ${result.totalTrades} trades`, 'success');
      api.getBacktestResults().then(setResults);
    } catch (err) {
      addToast(err.message, 'error');
    }
    setRunning(false);
  };

  const loadResult = async (id) => {
    try {
      const result = await api.getBacktestResult(id);
      setSelectedResult(result);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const equityCurve = selectedResult?.equity_curve || selectedResult?.equityCurve || [];

  return (
    <div className="p-4 flex gap-4 h-full">
      {/* Left: Config + Past Results */}
      <div className="w-[300px] flex flex-col gap-4">
        {/* Config */}
        <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
          <h3 className="text-sm font-semibold mb-3">Run Backtest</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Strategy</label>
              <select
                value={form.strategyId}
                onChange={e => setForm({ ...form, strategyId: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
              >
                <option value="">Select strategy...</option>
                {strategies.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Pair</label>
              <select
                value={form.symbol}
                onChange={e => setForm({ ...form, symbol: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
              >
                {PAIRS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Timeframe</label>
              <select
                value={form.timeframe}
                onChange={e => setForm({ ...form, timeframe: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
              >
                {TIMEFRAMES.map(tf => <option key={tf} value={tf}>{tf}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-slate-500 mb-1 block">Start</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm({ ...form, startDate: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-slate-500 mb-1 block">End</label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={e => setForm({ ...form, endDate: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
            <button
              onClick={runBacktest}
              disabled={running}
              className="w-full py-2.5 bg-yellow-500 text-black rounded font-semibold text-sm hover:bg-yellow-400 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {running ? (
                <><Clock size={14} className="animate-spin" /> Running...</>
              ) : (
                <><Play size={14} /> Run Backtest</>
              )}
            </button>
          </div>
        </div>

        {/* Past Results */}
        <div className="bg-[#12151a] rounded-lg border border-slate-800/50 flex-1 overflow-auto">
          <div className="px-4 py-3 border-b border-slate-800/50 text-sm font-medium text-slate-400">
            Past Results ({results.length})
          </div>
          <div className="divide-y divide-slate-800/50">
            {results.map(r => (
              <button
                key={r.id}
                onClick={() => loadResult(r.id)}
                className={`w-full px-4 py-3 text-left hover:bg-slate-800/30 ${
                  selectedResult?.id === r.id ? 'bg-slate-800/50' : ''
                }`}
              >
                <div className="text-sm font-medium">{r.strategy_name}</div>
                <div className="text-xs text-slate-500">{r.symbol} · {r.timeframe} · {r.total_trades} trades</div>
                <div className={`text-xs font-medium ${pnlColor(r.net_profit)}`}>
                  {formatUSD(r.net_profit)} ({formatPercent(r.net_profit_pct)})
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Results */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {selectedResult ? (
          <>
            {/* Metrics */}
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-lg font-semibold">{selectedResult.strategyName || selectedResult.strategy_name}</h2>
              <span className="text-sm text-slate-500">
                {selectedResult.symbol} · {selectedResult.timeframe}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-xs text-slate-400">Realistic Estimate</span>
                  <div
                    onClick={() => setShowRealistic(!showRealistic)}
                    className={`w-10 h-5 rounded-full flex items-center transition-colors cursor-pointer ${
                      showRealistic ? 'bg-yellow-500' : 'bg-slate-700'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform mx-0.5 ${
                      showRealistic ? 'translate-x-5' : ''
                    }`} />
                  </div>
                </label>
              </div>
            </div>

            {showRealistic && (
              <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-xs text-yellow-400">
                <AlertTriangle size={14} />
                Realistic estimates multiply raw results by 0.65 to simulate live market degradation (slippage, latency, partial fills)
              </div>
            )}

            <div className="grid grid-cols-4 gap-3">
              {[
                {
                  label: 'Net Profit',
                  value: formatUSD(showRealistic ? (selectedResult.realisticNetProfit || selectedResult.realistic_net_profit) : (selectedResult.netProfit || selectedResult.net_profit)),
                  color: pnlColor(selectedResult.netProfit || selectedResult.net_profit),
                },
                {
                  label: 'Win Rate',
                  value: `${(showRealistic ? (selectedResult.realisticWinRate || selectedResult.realistic_win_rate) : (selectedResult.winRate || selectedResult.win_rate))?.toFixed(1)}%`,
                  color: (selectedResult.winRate || selectedResult.win_rate) >= 50 ? 'text-emerald-400' : 'text-red-400',
                },
                {
                  label: 'Profit Factor',
                  value: (showRealistic ? (selectedResult.realisticProfitFactor || (selectedResult.profit_factor * 0.65 + 0.35)) : (selectedResult.profitFactor || selectedResult.profit_factor))?.toFixed(2),
                  color: 'text-white',
                },
                {
                  label: 'Total Trades',
                  value: selectedResult.totalTrades || selectedResult.total_trades,
                  color: 'text-white',
                },
                {
                  label: 'Max Drawdown',
                  value: formatUSD(selectedResult.maxDrawdown || selectedResult.max_drawdown),
                  sub: `${(selectedResult.maxDrawdownPct || selectedResult.max_drawdown_pct)?.toFixed(2)}%`,
                  color: 'text-red-400',
                },
                {
                  label: 'Sharpe Ratio',
                  value: (selectedResult.sharpeRatio || selectedResult.sharpe_ratio)?.toFixed(2),
                  color: 'text-white',
                },
                {
                  label: 'Avg Win',
                  value: formatUSD(selectedResult.avgWin || selectedResult.avg_win),
                  color: 'text-emerald-400',
                },
                {
                  label: 'Avg Loss',
                  value: formatUSD(selectedResult.avgLoss || selectedResult.avg_loss),
                  color: 'text-red-400',
                },
              ].map((m, i) => (
                <div key={i} className="bg-[#12151a] rounded-lg p-3 border border-slate-800/50">
                  <div className="text-xs text-slate-500 mb-1">{m.label}</div>
                  <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
                  {m.sub && <div className="text-xs text-slate-500">{m.sub}</div>}
                </div>
              ))}
            </div>

            {/* Equity Curve */}
            {equityCurve.length > 0 && (
              <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50 flex-1">
                <div className="text-sm font-medium text-slate-400 mb-3">Equity Curve</div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={equityCurve.map(p => ({
                    time: new Date(p.time).toLocaleDateString(),
                    equity: p.equity,
                  }))}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                      formatter={(v) => [formatUSD(v), 'Equity']}
                    />
                    <Area type="monotone" dataKey="equity" stroke="#eab308" fill="url(#eqGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-500">
            <div className="text-center">
              <FlaskConical size={48} className="mx-auto mb-3 opacity-50" />
              <div className="text-lg font-medium mb-1">No Results Selected</div>
              <div className="text-sm">Configure and run a backtest, or select a past result</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
