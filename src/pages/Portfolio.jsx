import React, { useState, useEffect } from 'react';
import { useApp } from '../App';
import { api } from '../lib/api';
import { formatUSD, formatCrypto, formatPercent, pnlColor, pnlBg } from '../lib/format';
import { PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Wallet, TrendingUp, ArrowLeftRight } from 'lucide-react';

const COLORS = ['#eab308', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#f97316', '#06b6d4', '#ec4899'];

export default function Portfolio() {
  const { portfolio, addToast, ws } = useApp();
  const [history, setHistory] = useState([]);
  const [transferModal, setTransferModal] = useState(false);
  const [transferForm, setTransferForm] = useState({ from: 'spot', to: 'futures', asset: 'USDT', amount: '' });

  useEffect(() => {
    api.getPortfolioHistory().then(setHistory).catch(() => {});
  }, []);

  const handleTransfer = async () => {
    try {
      await api.transfer(transferForm);
      addToast('Transfer complete', 'success');
      setTransferModal(false);
      setTransferForm({ from: 'spot', to: 'futures', asset: 'USDT', amount: '' });
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (!portfolio) return <div className="flex items-center justify-center h-full text-slate-500">Loading portfolio...</div>;

  const pieData = portfolio.holdings
    .filter(h => h.value > 0)
    .map(h => ({ name: h.asset, value: h.value }))
    .sort((a, b) => b.value - a.value);

  const historyData = history.map(h => ({
    time: new Date(h.snapshot_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    value: h.total_value_usdt,
  }));

  return (
    <div className="p-4 space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
          <div className="text-slate-500 text-xs mb-1">Total Value</div>
          <div className="text-2xl font-bold">{formatUSD(portfolio.totalValue)}</div>
        </div>
        <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
          <div className="text-slate-500 text-xs mb-1">Total PnL</div>
          <div className={`text-2xl font-bold ${pnlColor(portfolio.totalPnl)}`}>
            {formatUSD(portfolio.totalPnl)}
          </div>
          <div className={`text-sm ${pnlColor(portfolio.totalPnlPct)}`}>
            {formatPercent(portfolio.totalPnlPct)}
          </div>
        </div>
        <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
          <div className="text-slate-500 text-xs mb-1">Spot Value</div>
          <div className="text-2xl font-bold">{formatUSD(portfolio.spotValue)}</div>
        </div>
        <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
          <div className="flex items-center justify-between">
            <div className="text-slate-500 text-xs mb-1">Futures Value</div>
            <button
              onClick={() => setTransferModal(true)}
              className="text-slate-400 hover:text-yellow-400"
              title="Transfer between wallets"
            >
              <ArrowLeftRight size={14} />
            </button>
          </div>
          <div className="text-2xl font-bold">{formatUSD(portfolio.futuresValue)}</div>
          {portfolio.unrealizedPnl !== 0 && (
            <div className={`text-sm ${pnlColor(portfolio.unrealizedPnl)}`}>
              Unrealized: {formatUSD(portfolio.unrealizedPnl)}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Equity Curve */}
        <div className="col-span-2 bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
          <div className="text-sm font-medium text-slate-400 mb-3">Portfolio Value History</div>
          {historyData.length > 1 ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={historyData}>
                <defs>
                  <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ color: '#94a3b8' }}
                  formatter={(v) => [formatUSD(v), 'Value']}
                />
                <Area type="monotone" dataKey="value" stroke="#eab308" fill="url(#portGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-slate-500 text-sm">
              Portfolio snapshots will appear here (every 5 min)
            </div>
          )}
        </div>

        {/* Allocation Pie */}
        <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
          <div className="text-sm font-medium text-slate-400 mb-3">Asset Allocation</div>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                    formatter={(v) => formatUSD(v)}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                      <span>{d.name}</span>
                    </div>
                    <span className="text-slate-400">{formatUSD(d.value)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-[180px] flex items-center justify-center text-slate-500 text-sm">
              No holdings yet
            </div>
          )}
        </div>
      </div>

      {/* Holdings Table */}
      <div className="bg-[#12151a] rounded-lg border border-slate-800/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/50">
          <span className="text-sm font-medium text-slate-400">Holdings</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800/50">
              <th className="text-left px-4 py-2">Asset</th>
              <th className="text-right px-4 py-2">Balance</th>
              <th className="text-right px-4 py-2">Available</th>
              <th className="text-right px-4 py-2">Price</th>
              <th className="text-right px-4 py-2">Value</th>
              <th className="text-right px-4 py-2">% of Portfolio</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.map(h => (
              <tr key={h.asset} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                <td className="px-4 py-3 font-medium">{h.asset}</td>
                <td className="text-right px-4 py-3">{formatCrypto(h.balance)}</td>
                <td className="text-right px-4 py-3 text-slate-400">{formatCrypto(h.available)}</td>
                <td className="text-right px-4 py-3">{h.asset === 'USDT' ? '$1.00' : formatUSD(h.price)}</td>
                <td className="text-right px-4 py-3 font-medium">{formatUSD(h.value)}</td>
                <td className="text-right px-4 py-3 text-slate-400">
                  {portfolio.totalValue > 0 ? ((h.value / portfolio.totalValue) * 100).toFixed(1) : '0'}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Transfer Modal */}
      {transferModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setTransferModal(false)}>
          <div className="bg-[#12151a] rounded-xl border border-slate-700 p-6 w-[400px]" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Transfer Between Wallets</h3>
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 mb-1 block">From</label>
                  <select
                    value={transferForm.from}
                    onChange={e => setTransferForm({ ...transferForm, from: e.target.value, to: e.target.value === 'spot' ? 'futures' : 'spot' })}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
                  >
                    <option value="spot">Spot Wallet</option>
                    <option value="futures">Futures Wallet</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500 mb-1 block">To</label>
                  <select
                    value={transferForm.to}
                    onChange={e => setTransferForm({ ...transferForm, to: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
                  >
                    <option value="spot">Spot Wallet</option>
                    <option value="futures">Futures Wallet</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Amount (USDT)</label>
                <input
                  type="number"
                  value={transferForm.amount}
                  onChange={e => setTransferForm({ ...transferForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:border-yellow-500"
                />
              </div>
              <button
                onClick={handleTransfer}
                className="w-full py-2.5 bg-yellow-500 text-black rounded font-semibold text-sm hover:bg-yellow-400"
              >
                Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
