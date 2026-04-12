import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatPercent, formatNumber } from '../lib/format';
import { useApp } from '../App';
import { Search, Star, TrendingUp, ArrowDown, FlaskConical, RefreshCw, ExternalLink, HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';

const TYPE_COLORS = {
  trend: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  mean_reversion: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  scalping: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  swing: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
};

export default function StrategyDiscovery() {
  const { addToast } = useApp();
  const [strategies, setStrategies] = useState([]);
  const [filters, setFilters] = useState({ sort: 'score', type: '' });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    api.getStrategies(filters).then(setStrategies).catch(() => {});
  }, [filters]);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await api.refreshStrategies();
      const updated = await api.getStrategies(filters);
      setStrategies(updated);
      addToast('Strategies refreshed', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
    setLoading(false);
  };

  return (
    <div className="p-4 flex gap-4 h-full">
      {/* Strategy List */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-lg font-semibold">Strategy Discovery</h2>
          <div className="flex gap-2 ml-auto">
            <select
              value={filters.type}
              onChange={e => setFilters({ ...filters, type: e.target.value })}
              className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
            >
              <option value="">All Types</option>
              <option value="trend">Trend Following</option>
              <option value="mean_reversion">Mean Reversion</option>
              <option value="scalping">Scalping</option>
              <option value="swing">Swing</option>
            </select>
            <select
              value={filters.sort}
              onChange={e => setFilters({ ...filters, sort: e.target.value })}
              className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
            >
              <option value="score">Composite Score</option>
              <option value="win_rate">Win Rate</option>
              <option value="profit_factor">Profit Factor</option>
              <option value="likes">Most Popular</option>
              <option value="newest">Newest</option>
            </select>
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded text-sm hover:bg-yellow-500/20"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        </div>

        {/* Metrics Guide */}
        <div className="mb-3">
          <button
            onClick={() => setShowGuide(!showGuide)}
            className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <HelpCircle size={14} />
            <span>What do these numbers mean?</span>
            {showGuide ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showGuide && (
            <div className="mt-2 bg-[#12151a] border border-slate-800/50 rounded-lg p-4 grid grid-cols-2 gap-x-8 gap-y-3 text-xs">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Star size={12} className="text-yellow-400" fill="currentColor" />
                  <span className="font-semibold text-white">Composite Score</span>
                </div>
                <p className="text-slate-400">An overall rating from 0 to ~1.2 that combines all the metrics below into a single number. Higher is better. Think of it as a "grade" for the strategy.</p>
              </div>
              <div>
                <div className="font-semibold text-emerald-400 mb-1">Win Rate</div>
                <p className="text-slate-400">The percentage of trades that made money. A 58% win rate means 58 out of every 100 trades were profitable. Above 50% is good, but it's not the only thing that matters.</p>
              </div>
              <div>
                <div className="font-semibold text-white mb-1">Profit Factor</div>
                <p className="text-slate-400">Total money won divided by total money lost. A profit factor of 1.85 means for every $1 lost, the strategy earned $1.85. Anything above 1.5 is solid; below 1.0 means it loses money overall.</p>
              </div>
              <div>
                <div className="font-semibold text-red-400 mb-1">Max Drawdown (Max DD)</div>
                <p className="text-slate-400">The biggest peak-to-valley drop the strategy experienced. A 15% max DD means at its worst, you would have seen your account drop 15% from its highest point. Lower is safer.</p>
              </div>
              <div>
                <div className="font-semibold text-white mb-1">Net Profit %</div>
                <p className="text-slate-400">The total return the strategy produced during its backtest period. A 42.5% net profit on a $100K account means it made $42,500. This is the raw number before applying realistic estimates.</p>
              </div>
              <div>
                <div className="mb-1">
                  <span className="font-semibold text-blue-400">Trend</span>
                  <span className="text-slate-500 mx-1">|</span>
                  <span className="font-semibold text-emerald-400">Swing</span>
                  <span className="text-slate-500 mx-1">|</span>
                  <span className="font-semibold text-orange-400">Scalping</span>
                  <span className="text-slate-500 mx-1">|</span>
                  <span className="font-semibold text-purple-400">Mean Reversion</span>
                </div>
                <p className="text-slate-400">The strategy style. <strong className="text-slate-300">Trend</strong> rides momentum. <strong className="text-slate-300">Swing</strong> catches multi-day moves. <strong className="text-slate-300">Scalping</strong> takes many small, quick trades. <strong className="text-slate-300">Mean Reversion</strong> bets prices will snap back to average.</p>
              </div>
            </div>
          )}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 gap-3 overflow-auto">
          {strategies.map(s => (
            <div
              key={s.id}
              onClick={() => setSelected(s)}
              className={`bg-[#12151a] rounded-lg p-4 border cursor-pointer transition-colors ${
                selected?.id === s.id
                  ? 'border-yellow-500/50 bg-yellow-500/5'
                  : 'border-slate-800/50 hover:border-slate-600'
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-medium text-sm">{s.name}</h3>
                <div className="flex items-center gap-1 text-yellow-400 text-xs">
                  <Star size={12} fill="currentColor" />
                  {s.composite_score?.toFixed(2)}
                </div>
              </div>
              <p className="text-xs text-slate-400 mb-3 line-clamp-2">{s.description}</p>
              <div className="flex items-center gap-2 mb-2">
                {s.strategy_type && (
                  <span className={`text-xs px-2 py-0.5 rounded border capitalize ${TYPE_COLORS[s.strategy_type] || ''}`}>
                    {s.strategy_type.replace('_', ' ')}
                  </span>
                )}
                {s.author && (
                  <span className="text-xs text-slate-500">by {s.author}</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-slate-500">Win Rate</div>
                  <div className={`font-medium ${s.win_rate >= 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(s.win_rate * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Profit Factor</div>
                  <div className={`font-medium ${s.profit_factor >= 1.5 ? 'text-emerald-400' : 'text-yellow-400'}`}>
                    {s.profit_factor?.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Max DD</div>
                  <div className="font-medium text-red-400">
                    {(s.max_drawdown * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      {selected && (
        <div className="w-[380px] bg-[#12151a] rounded-lg border border-slate-800/50 p-4 overflow-auto">
          <h3 className="text-lg font-semibold mb-1">{selected.name}</h3>
          <p className="text-sm text-slate-400 mb-4">{selected.description}</p>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-slate-800/50 rounded p-3">
              <div className="text-xs text-slate-500 mb-1">Win Rate</div>
              <div className="text-lg font-bold text-emerald-400">
                {(selected.win_rate * 100).toFixed(1)}%
              </div>
            </div>
            <div className="bg-slate-800/50 rounded p-3">
              <div className="text-xs text-slate-500 mb-1">Profit Factor</div>
              <div className="text-lg font-bold">{selected.profit_factor?.toFixed(2)}</div>
            </div>
            <div className="bg-slate-800/50 rounded p-3">
              <div className="text-xs text-slate-500 mb-1">Max Drawdown</div>
              <div className="text-lg font-bold text-red-400">
                {(selected.max_drawdown * 100).toFixed(1)}%
              </div>
            </div>
            <div className="bg-slate-800/50 rounded p-3">
              <div className="text-xs text-slate-500 mb-1">Net Profit</div>
              <div className="text-lg font-bold text-emerald-400">
                {selected.net_profit_pct?.toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
            <Star size={12} /> {selected.likes?.toLocaleString()} likes
            {selected.source_url && (
              <>
                <span className="mx-1">·</span>
                <a href={selected.source_url} target="_blank" rel="noopener" className="text-blue-400 hover:underline flex items-center gap-1">
                  TradingView <ExternalLink size={10} />
                </a>
              </>
            )}
          </div>

          {selected.pine_script && (
            <div className="mb-4">
              <div className="text-xs text-slate-500 mb-1">Pine Script</div>
              <pre className="bg-slate-900 rounded p-3 text-xs text-slate-300 overflow-auto max-h-[200px] font-mono">
                {selected.pine_script}
              </pre>
            </div>
          )}

          <div className="space-y-2">
            <button className="w-full py-2.5 bg-yellow-500 text-black rounded font-semibold text-sm hover:bg-yellow-400 flex items-center justify-center gap-2">
              <FlaskConical size={14} />
              Backtest This Strategy
            </button>
            <div className="text-xs text-slate-500 text-center">
              Set up a TradingView alert with this strategy and point it to your webhook URL
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
