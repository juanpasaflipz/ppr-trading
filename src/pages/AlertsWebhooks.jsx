import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useApp } from '../App';
import { formatDate } from '../lib/format';
import { Copy, CheckCircle, Bell, Send, FileText, AlertTriangle } from 'lucide-react';

export default function AlertsWebhooks() {
  const { addToast, config } = useApp();
  const [alerts, setAlerts] = useState([]);
  const [copied, setCopied] = useState('');
  const [testPayload, setTestPayload] = useState(JSON.stringify({
    secret: 'change_this_to_a_secure_random_string',
    action: 'buy',
    symbol: 'BTCUSDT',
    type: 'spot',
    orderType: 'market',
    quantityPercent: 5,
    comment: 'Test alert',
  }, null, 2));

  useEffect(() => {
    api.getAlerts(100).then(setAlerts).catch(() => {});
    const iv = setInterval(() => api.getAlerts(100).then(setAlerts).catch(() => {}), 5000);
    return () => clearInterval(iv);
  }, []);

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
    addToast('Copied to clipboard', 'info');
  };

  const sendTest = async () => {
    try {
      const payload = JSON.parse(testPayload);
      const res = await fetch('/api/webhook/tradingview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        addToast('Test alert executed successfully', 'success');
      } else {
        addToast(`Alert failed: ${data.error}`, 'error');
      }
      api.getAlerts(100).then(setAlerts);
    } catch (err) {
      addToast(`Invalid JSON: ${err.message}`, 'error');
    }
  };

  const webhookUrl = `${window.location.origin}/api/webhook/tradingview`;

  const statusColors = {
    executed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    rejected: 'bg-red-500/10 text-red-400 border-red-500/30',
    error: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  };

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Webhook Config */}
        <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Bell size={16} className="text-yellow-400" />
            Webhook Configuration
          </h3>

          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Webhook URL</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={webhookUrl}
                  className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm font-mono"
                />
                <button
                  onClick={() => copyToClipboard(webhookUrl, 'url')}
                  className="px-3 py-2 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700"
                >
                  {copied === 'url' ? <CheckCircle size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-500 mb-1 block">Secret Key</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={config?.webhook_secret || 'change_this_to_a_secure_random_string'}
                  type="password"
                  className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm font-mono"
                />
                <button
                  onClick={() => copyToClipboard(config?.webhook_secret || 'change_this_to_a_secure_random_string', 'secret')}
                  className="px-3 py-2 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700"
                >
                  {copied === 'secret' ? <CheckCircle size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Test Alert */}
        <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Send size={16} className="text-blue-400" />
            Send Test Alert
          </h3>
          <textarea
            value={testPayload}
            onChange={e => setTestPayload(e.target.value)}
            rows={8}
            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-xs font-mono resize-none outline-none focus:border-yellow-500"
          />
          <button
            onClick={sendTest}
            className="mt-2 w-full py-2 bg-blue-500 text-white rounded font-semibold text-sm hover:bg-blue-600"
          >
            Send Test Alert
          </button>
        </div>
      </div>

      {/* Alert Format Docs */}
      <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <FileText size={16} className="text-slate-400" />
          Alert Format Reference
        </h3>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <div className="text-slate-400 mb-2 font-medium">Required Fields</div>
            <table className="w-full">
              <tbody className="divide-y divide-slate-800/50">
                {[
                  ['secret', 'string', 'Your webhook secret key'],
                  ['action', '"buy" | "sell" | "close"', 'Trade action'],
                  ['symbol', 'string', 'Trading pair (e.g., BTCUSDT)'],
                ].map(([field, type, desc]) => (
                  <tr key={field}>
                    <td className="py-1.5 font-mono text-yellow-400">{field}</td>
                    <td className="py-1.5 text-slate-500 px-2">{type}</td>
                    <td className="py-1.5 text-slate-400">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-slate-400 mb-2 font-medium">Optional Fields</div>
            <table className="w-full">
              <tbody className="divide-y divide-slate-800/50">
                {[
                  ['type', '"spot" | "futures"', 'Default: spot'],
                  ['orderType', '"market" | "limit"', 'Default: market'],
                  ['quantity', 'number', 'Absolute qty'],
                  ['quantityPercent', 'number', '% of portfolio'],
                  ['leverage', 'number', 'Futures leverage'],
                  ['takeProfit', 'number', 'TP price'],
                  ['stopLoss', 'number', 'SL price'],
                ].map(([field, type, desc]) => (
                  <tr key={field}>
                    <td className="py-1.5 font-mono text-slate-300">{field}</td>
                    <td className="py-1.5 text-slate-500 px-2">{type}</td>
                    <td className="py-1.5 text-slate-400">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Alert History */}
      <div className="bg-[#12151a] rounded-lg border border-slate-800/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800/50 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-400">Alert History ({alerts.length})</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-slate-500 text-xs border-b border-slate-800/50">
              <th className="text-left px-4 py-2">Time</th>
              <th className="text-left px-4 py-2">Action</th>
              <th className="text-left px-4 py-2">Symbol</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-slate-500">
                  No alerts received yet. Send a test alert or connect TradingView.
                </td>
              </tr>
            ) : (
              alerts.map(a => (
                <tr key={a.id} className="border-b border-slate-800/30 hover:bg-slate-800/20">
                  <td className="px-4 py-2.5 text-slate-400">{formatDate(a.received_at)}</td>
                  <td className="px-4 py-2.5 font-medium uppercase">{a.parsed_action || '—'}</td>
                  <td className="px-4 py-2.5">{a.symbol || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded border text-xs capitalize ${statusColors[a.status]}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400 truncate max-w-[300px]">
                    {a.error_message || (a.order_id ? `Order #${a.order_id}` : '—')}
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
