import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatUSD, formatCrypto, formatDate, formatPercent, pnlColor, pnlBg, formatNumber } from '../lib/format';
import { Download, Filter } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function TradeHistory() {
  const [trades, setTrades] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState({ symbol: '', marketType: '' });

  useEffect(() => {
    api.getTrades({ limit: 200 }).then(setTrades).catch(() => {});
    api.getTradeSummary().then(setSummary).catch(() => {});
  }, []);

  const filteredTrades = trades.filter(t => {
    if (filter.symbol && t.symbol !== filter.symbol) return false;
    if (filter.marketType && t.market_type !== filter.marketType) return false;
    return true;
  });

  const handleExport = async () => {
    try {
      const csv = await api.exportTrades();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'trades.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
            <div className="text-slate-500 text-xs mb-1">Total Trades</div>
            <div className="text-xl font-bold">{summary.totalTrades}</div>
          </div>
          <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
            <div className="text-slate-500 text-xs mb-1">Win Rate</div>
            <div className={`text-xl font-bold ${summary.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
              {summary.winRate.toFixed(1)}%
            </div>
          </div>
          <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
            <div className="text-slate-500 text-xs mb-1">Total PnL</div>
            <div className={`text-xl font-bold ${pnlColor(summary.totalPnl)}`}>
              {formatUSD(summary.totalPnl)}
            </div>
          </div>
          <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
            <div className="text-slate-500 text-xs mb-1">Avg Win</div>
            <div className="text-xl font-bold text-emerald-400">{formatUSD(summary.avgWin)}</div>
          </div>
          <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
            <div className="text-slate-500 text-xs mb-1">Avg Loss</div>
            <div className="text-xl font-bold text-red-400">{formatUSD(summary.avgLoss)}</div>
          </div>
        </div>
      )}

      {/* Daily PnL Chart */}
      {summary?.dailySummary?.length > 0 && (
        <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
          <div className="text-sm font-medium text-slate-400 mb-3">Daily PnL</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={summary.dailySummary.slice(-30).reverse()}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v) => [formatUSD(v), 'PnL']}
              />
              <Bar dataKey="pnl" fill="#eab308">
                {summary.dailySummary.slice(-30).reverse().map((entry, i) => (
                  <rect key={i} fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filters + Export */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-slate-500" />
          <select
            value={filter.symbol}
            onChange={e => setFilter({ ...filter, symbol: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
          >
            <option value="">All Pairs</option>
            {[...new Set(trades.map(t => t.symbol))].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={filter.marketType}
            onChange={e => setFilter({ ...filter, marketType: e.target.value })}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-white"
          >
            <option value="">All Types</option>
            <option value="spot">Spot</option>
            <option value="futures">Futures</option>
          </select>
        </div>
        <button
          onClick={handleExport}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-slate-800 rounded text-sm text-slate-400 hover:text-white border border-slate-700"
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      {/* Trades Table */}
      <div className="bg-[#12151a] rounded-lg border border-slate-800/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800/50">
              <th className="text-left px-4 py-2">Date</th>
              <th className="text-left px-4 py-2">Pair</th>
              <th className="text-left px-4 py-2">Type</th>
              <th className="text-left px-4 py-2">Side</th>
              <th className="text-right px-4 py-2">Price</th>
              <th className="text-right px-4 py-2">Quantity</th>
              <th className="text-right px-4 py-2">Fee</th>
              <th className="text-right px-4 py-2">PnL</th>
            </tr>
          </thead>
          <tbody>
            {filteredTrades.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-slate-500">
                  No trades yet. Place your first order in the Terminal.
                </td>
              </tr>
            ) : (
              filteredTrades.map(t => (
                <tr key={t.id} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                  <td className="px-4 py-2.5 text-slate-400">{formatDate(t.executed_at)}</td>
                  <td className="px-4 py-2.5 font-medium">{t.symbol}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded text-xs bg-slate-800 capitalize">{t.market_type}</span>
                  </td>
                  <td className={`px-4 py-2.5 font-medium ${t.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {t.side.toUpperCase()}
                  </td>
                  <td className="text-right px-4 py-2.5">{formatNumber(t.price)}</td>
                  <td className="text-right px-4 py-2.5">{formatCrypto(t.quantity, 4)}</td>
                  <td className="text-right px-4 py-2.5 text-slate-400">{formatUSD(t.fee)}</td>
                  <td className={`text-right px-4 py-2.5 font-medium ${pnlColor(t.realized_pnl)}`}>
                    {t.realized_pnl ? formatUSD(t.realized_pnl) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
