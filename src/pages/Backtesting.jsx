import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useApp } from '../App';
import { formatUSD, formatPercent, pnlColor } from '../lib/format';
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Bot, ChevronLeft, ChevronRight, Clock, FlaskConical, Pause, Play, Sparkles } from 'lucide-react';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const STRATEGY_COLORS = ['#eab308', '#38bdf8', '#f97316'];

function MetricCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-[#12151a] rounded-lg p-3 border border-slate-800/50">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      {sub ? <div className="text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function StrategyDecisionCard({ strategy, colorClass }) {
  return (
    <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="font-semibold">{strategy.strategyName}</div>
          <div className="text-xs text-slate-500 capitalize">{strategy.family?.replace('_', ' ') || 'strategy'}</div>
        </div>
        <div className={`px-2.5 py-1 rounded text-xs font-semibold border ${colorClass}`}>
          {strategy.action.toUpperCase()}
        </div>
      </div>

      <div className="text-sm text-slate-300 mb-3">{strategy.explanation.summary}</div>

      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        {Object.entries(strategy.explanation.state || {}).map(([key, value]) => (
          <div key={key} className="bg-slate-900/60 rounded px-2 py-1 border border-slate-800/70">
            <span className="text-slate-500 mr-1 uppercase">{key}</span>
            <span className="text-slate-200">{value ?? '-'}</span>
          </div>
        ))}
      </div>

      <div className="space-y-2 text-xs">
        <div>
          <div className="text-slate-500 mb-1">Reasons</div>
          <div className="flex flex-wrap gap-1.5">
            {(strategy.explanation.reasons || []).length ? strategy.explanation.reasons.map((reason) => (
              <span key={reason} className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                {reason}
              </span>
            )) : <span className="text-slate-500">No active trigger</span>}
          </div>
        </div>
        <div>
          <div className="text-slate-500 mb-1">Blockers</div>
          <div className="flex flex-wrap gap-1.5">
            {(strategy.explanation.blockers || []).length ? strategy.explanation.blockers.map((reason) => (
              <span key={reason} className="px-2 py-1 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {reason}
              </span>
            )) : <span className="text-slate-500">No blockers recorded</span>}
          </div>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs">
        <span className="text-slate-500">Equity</span>
        <span className={pnlColor(strategy.equity - 100000)}>{formatUSD(strategy.equity)}</span>
      </div>
    </div>
  );
}

export default function Backtesting() {
  const { addToast } = useApp();
  const [mode, setMode] = useState('arena');
  const [strategies, setStrategies] = useState([]);
  const [results, setResults] = useState([]);
  const [selectedResult, setSelectedResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [showRealistic, setShowRealistic] = useState(false);
  const [arenaRunning, setArenaRunning] = useState(false);
  const [arenaResult, setArenaResult] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [form, setForm] = useState({
    strategyId: '',
    symbol: 'BTCUSDT',
    timeframe: '1h',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
  });

  const [arenaForm, setArenaForm] = useState({
    strategyIds: ['ema_cross', 'rsi_oversold'],
    symbol: 'BTCUSDT',
    timeframe: '1h',
    startDate: '2024-01-01',
    endDate: '2024-03-31',
  });

  useEffect(() => {
    api.getBacktestStrategies().then((data) => {
      setStrategies(data);
      setForm((current) => ({ ...current, strategyId: current.strategyId || data[0]?.id || '' }));
    }).catch(() => {});
    api.getBacktestResults().then(setResults).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isPlaying || !arenaResult?.timeline?.length) return undefined;
    const interval = setInterval(() => {
      setStepIndex((current) => {
        if (current >= arenaResult.timeline.length - 1) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 700);
    return () => clearInterval(interval);
  }, [isPlaying, arenaResult]);

  const arenaStep = arenaResult?.timeline?.[stepIndex] || null;

  const arenaEquityData = useMemo(() => {
    if (!arenaResult?.strategies?.length) return [];
    const steps = arenaResult.timeline || [];
    return steps.map((step) => {
      const row = {
        time: new Date(step.time).toLocaleDateString(),
        price: step.candle.close,
      };
      step.strategies.forEach((strategy) => {
        row[strategy.strategyName] = strategy.equity;
      });
      return row;
    });
  }, [arenaResult]);

  const toggleArenaStrategy = (id) => {
    setArenaForm((current) => {
      const alreadySelected = current.strategyIds.includes(id);
      let next = current.strategyIds;

      if (alreadySelected) {
        next = current.strategyIds.filter((item) => item !== id);
      } else {
        next = [...current.strategyIds, id].slice(-3);
      }

      return { ...current, strategyIds: next };
    });
  };

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

  const runArena = async () => {
    if (arenaForm.strategyIds.length < 2) {
      addToast('Select at least two strategies', 'warning');
      return;
    }

    setArenaRunning(true);
    setIsPlaying(false);
    try {
      const result = await api.runArenaBacktest(arenaForm);
      setArenaResult(result);
      setStepIndex(0);
      addToast(`Arena ready: ${result.timeline.length} replay steps`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
    setArenaRunning(false);
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
      <div className="w-[330px] flex flex-col gap-4">
        <div className="bg-[#12151a] rounded-lg p-2 border border-slate-800/50 flex">
          {[
            { id: 'arena', label: 'Arena' },
            { id: 'single', label: 'Classic' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setMode(tab.id)}
              className={`flex-1 py-2 rounded text-sm font-medium ${
                mode === tab.id ? 'bg-yellow-500 text-black' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === 'arena' ? (
          <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
            <div className="flex items-center gap-2 mb-3">
              <Bot size={16} className="text-yellow-400" />
              <h3 className="text-sm font-semibold">Strategy Arena</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-2 block">Strategies</label>
                <div className="space-y-2">
                  {strategies.map((strategy) => {
                    const checked = arenaForm.strategyIds.includes(strategy.id);
                    return (
                      <button
                        key={strategy.id}
                        onClick={() => toggleArenaStrategy(strategy.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left ${
                          checked ? 'border-yellow-500/60 bg-yellow-500/10' : 'border-slate-700 bg-slate-900/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium">{strategy.name}</div>
                            <div className="text-xs text-slate-500">{strategy.description}</div>
                          </div>
                          <div className={`w-4 h-4 rounded border ${checked ? 'bg-yellow-500 border-yellow-500' : 'border-slate-600'}`} />
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="text-xs text-slate-500 mt-2">Choose 2-3 strategies. The last three selected are kept.</div>
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">Pair</label>
                <select
                  value={arenaForm.symbol}
                  onChange={(e) => setArenaForm({ ...arenaForm, symbol: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                >
                  {PAIRS.map((pair) => <option key={pair} value={pair}>{pair}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">Timeframe</label>
                <select
                  value={arenaForm.timeframe}
                  onChange={(e) => setArenaForm({ ...arenaForm, timeframe: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                >
                  {TIMEFRAMES.map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                </select>
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 mb-1 block">Start</label>
                  <input
                    type="date"
                    value={arenaForm.startDate}
                    onChange={(e) => setArenaForm({ ...arenaForm, startDate: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500 mb-1 block">End</label>
                  <input
                    type="date"
                    value={arenaForm.endDate}
                    onChange={(e) => setArenaForm({ ...arenaForm, endDate: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>

              <button
                onClick={runArena}
                disabled={arenaRunning}
                className="w-full py-2.5 bg-yellow-500 text-black rounded font-semibold text-sm hover:bg-yellow-400 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {arenaRunning ? <><Clock size={14} className="animate-spin" /> Building Arena...</> : <><Sparkles size={14} /> Run Strategy Arena</>}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
              <h3 className="text-sm font-semibold mb-3">Run Backtest</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Strategy</label>
                  <select
                    value={form.strategyId}
                    onChange={(e) => setForm({ ...form, strategyId: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                  >
                    <option value="">Select strategy...</option>
                    {strategies.map((strategy) => (
                      <option key={strategy.id} value={strategy.id}>{strategy.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Pair</label>
                  <select
                    value={form.symbol}
                    onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                  >
                    {PAIRS.map((pair) => <option key={pair} value={pair}>{pair}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Timeframe</label>
                  <select
                    value={form.timeframe}
                    onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                  >
                    {TIMEFRAMES.map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 mb-1 block">Start</label>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 mb-1 block">End</label>
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>
                <button
                  onClick={runBacktest}
                  disabled={running}
                  className="w-full py-2.5 bg-yellow-500 text-black rounded font-semibold text-sm hover:bg-yellow-400 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {running ? <><Clock size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run Backtest</>}
                </button>
              </div>
            </div>

            <div className="bg-[#12151a] rounded-lg border border-slate-800/50 flex-1 overflow-auto">
              <div className="px-4 py-3 border-b border-slate-800/50 text-sm font-medium text-slate-400">
                Past Results ({results.length})
              </div>
              <div className="divide-y divide-slate-800/50">
                {results.map((result) => (
                  <button
                    key={result.id}
                    onClick={() => loadResult(result.id)}
                    className={`w-full px-4 py-3 text-left hover:bg-slate-800/30 ${
                      selectedResult?.id === result.id ? 'bg-slate-800/50' : ''
                    }`}
                  >
                    <div className="text-sm font-medium">{result.strategy_name}</div>
                    <div className="text-xs text-slate-500">{result.symbol} · {result.timeframe} · {result.total_trades} trades</div>
                    <div className={`text-xs font-medium ${pnlColor(result.net_profit)}`}>
                      {formatUSD(result.net_profit)} ({formatPercent(result.net_profit_pct)})
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {mode === 'arena' ? (
          arenaResult ? (
            <>
              <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Strategy Arena Replay</h2>
                    <div className="text-sm text-slate-500">
                      {arenaResult.symbol} · {arenaResult.timeframe} · {arenaResult.startDate} to {arenaResult.endDate}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                      className="p-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={() => setIsPlaying((current) => !current)}
                      className="px-3 py-2 rounded bg-yellow-500 text-black text-sm font-semibold flex items-center gap-2"
                    >
                      {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    <button
                      onClick={() => setStepIndex((current) => Math.min((arenaResult.timeline?.length || 1) - 1, current + 1))}
                      className="p-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <input
                    type="range"
                    min="0"
                    max={Math.max((arenaResult.timeline?.length || 1) - 1, 0)}
                    value={stepIndex}
                    onChange={(e) => setStepIndex(Number(e.target.value))}
                    className="w-full accent-yellow-500"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                    <span>Step {stepIndex + 1} / {arenaResult.timeline.length}</span>
                    <span>{arenaStep ? new Date(arenaStep.time).toLocaleString() : '-'}</span>
                    <span>Close {arenaStep ? formatUSD(arenaStep.candle.close) : '-'}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {arenaResult.strategies.map((strategy) => (
                  <MetricCard
                    key={strategy.strategyId}
                    label={strategy.strategyName}
                    value={formatUSD(strategy.netProfit)}
                    sub={`${strategy.totalTrades} trades · ${strategy.winRate.toFixed(1)}% win rate`}
                    color={pnlColor(strategy.netProfit)}
                  />
                ))}
              </div>

              <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
                <div className="text-sm font-medium text-slate-400 mb-3">Shared Equity Comparison</div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={arenaEquityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                      formatter={(value) => [formatUSD(value), 'Equity']}
                    />
                    <Legend />
                    {arenaResult.strategies.map((strategy, index) => (
                      <Line
                        key={strategy.strategyId}
                        type="monotone"
                        dataKey={strategy.strategyName}
                        dot={false}
                        stroke={STRATEGY_COLORS[index % STRATEGY_COLORS.length]}
                        strokeWidth={2}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                {arenaStep?.strategies?.map((strategy, index) => (
                  <StrategyDecisionCard
                    key={strategy.strategyId}
                    strategy={strategy}
                    colorClass={
                      strategy.action === 'buy'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                        : strategy.action === 'sell'
                          ? 'border-red-500/30 bg-red-500/10 text-red-300'
                          : 'border-slate-700 bg-slate-900/50 text-slate-300'
                    }
                  />
                ))}
              </div>

              <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
                <div className="text-sm font-medium text-slate-400 mb-3">Key Divergence Moments</div>
                <div className="space-y-2 max-h-[240px] overflow-auto pr-1">
                  {arenaResult.keyMoments.map((moment) => (
                    <button
                      key={`${moment.time}-${moment.index}`}
                      onClick={() => setStepIndex(Math.max(0, moment.index - 50))}
                      className="w-full text-left rounded-lg border border-slate-800/60 bg-slate-900/40 px-3 py-3 hover:bg-slate-800/50"
                    >
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="text-sm font-medium">{new Date(moment.time).toLocaleString()}</div>
                        <div className="text-xs text-slate-500">Close {formatUSD(moment.price)}</div>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {moment.actions.map((action) => (
                          <span key={`${moment.time}-${action.strategyId}`} className="px-2 py-1 rounded bg-slate-800 text-slate-200 border border-slate-700">
                            {action.strategyName}: {action.action}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center max-w-xl">
                <Sparkles size={48} className="mx-auto mb-3 opacity-50" />
                <div className="text-lg font-medium mb-1">Run a Strategy Arena</div>
                <div className="text-sm">
                  Compare 2-3 strategies on the same historical tape, then step through the replay to see why they diverged.
                </div>
              </div>
            </div>
          )
        ) : selectedResult ? (
          <>
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
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform mx-0.5 ${showRealistic ? 'translate-x-5' : ''}`} />
                  </div>
                </label>
              </div>
            </div>

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
              ].map((metric) => (
                <MetricCard key={metric.label} label={metric.label} value={metric.value} sub={metric.sub} color={metric.color} />
              ))}
            </div>

            {equityCurve.length > 0 && (
              <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50 flex-1">
                <div className="text-sm font-medium text-slate-400 mb-3">Equity Curve</div>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={equityCurve.map((point) => ({
                    time: new Date(point.time).toLocaleDateString(),
                    equity: point.equity,
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
                      formatter={(value) => [formatUSD(value), 'Equity']}
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
