import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useApp } from '../App';
import { Save, AlertTriangle, Shield, Sliders, Key, Palette } from 'lucide-react';

export default function SettingsPage() {
  const { config, setConfig, addToast } = useApp();
  const [form, setForm] = useState({});
  const [showLiveConfirm, setShowLiveConfirm] = useState(false);
  const [liveConfirmText, setLiveConfirmText] = useState('');

  useEffect(() => {
    if (config) {
      setForm({
        starting_balance: config.starting_balance || '100000',
        maker_fee: config.maker_fee || '0.001',
        taker_fee: config.taker_fee || '0.001',
        default_leverage: config.default_leverage || '1',
        slippage: config.slippage || '0.0005',
        max_position_size_pct: config.max_position_size_pct || '25',
        daily_loss_limit: config.daily_loss_limit || '10000',
        max_leverage: config.max_leverage || '125',
        llm_provider: config.llm_provider || 'openai',
        llm_model: config.llm_model || config.llm_available_models?.[0] || 'gpt-5.4',
      });
    }
  }, [config]);

  const handleSave = async () => {
    try {
      await api.updateConfig(form);
      const updated = await api.getConfig();
      setConfig(updated);
      addToast('Settings saved', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleModeSwitch = async () => {
    const newMode = config?.trading_mode === 'live' ? 'paper' : 'live';
    if (newMode === 'live') {
      setShowLiveConfirm(true);
      return;
    }

    try {
      await api.updateConfig({ trading_mode: 'paper' });
      const updated = await api.getConfig();
      setConfig(updated);
      addToast('Switched to PAPER mode', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const confirmLiveMode = async () => {
    if (liveConfirmText !== 'I_UNDERSTAND_REAL_MONEY') {
      addToast('Type the confirmation phrase exactly', 'warning');
      return;
    }
    try {
      await api.updateConfig({ trading_mode: 'live', confirmation: liveConfirmText });
      const updated = await api.getConfig();
      setConfig(updated);
      setShowLiveConfirm(false);
      setLiveConfirmText('');
      addToast('WARNING: Switched to LIVE mode', 'warning');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const isLive = config?.trading_mode === 'live';

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <h2 className="text-lg font-semibold">Settings</h2>

      {/* Trading Mode */}
      <div className={`bg-[#12151a] rounded-lg p-4 border ${isLive ? 'border-red-500/50' : 'border-slate-800/50'}`}>
        <div className="flex items-center gap-3 mb-3">
          <Shield size={18} className={isLive ? 'text-red-400' : 'text-yellow-400'} />
          <h3 className="text-sm font-semibold">Trading Mode</h3>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className={`text-lg font-bold ${isLive ? 'text-red-400' : 'text-yellow-400'}`}>
              {isLive ? 'LIVE TRADING' : 'PAPER TRADING'}
            </div>
            <div className="text-xs text-slate-500">
              {isLive
                ? 'Orders are executed with REAL money on Binance'
                : 'Orders are simulated using virtual $100,000 USDT'}
            </div>
          </div>
          <button
            onClick={handleModeSwitch}
            className={`px-4 py-2 rounded font-semibold text-sm ${
              isLive
                ? 'bg-yellow-500 text-black hover:bg-yellow-400'
                : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20'
            }`}
          >
            Switch to {isLive ? 'Paper' : 'Live'}
          </button>
        </div>
      </div>

      {/* Fee Settings */}
      <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
        <div className="flex items-center gap-3 mb-3">
          <Sliders size={18} className="text-blue-400" />
          <h3 className="text-sm font-semibold">Trading Settings</h3>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            { key: 'starting_balance', label: 'Starting Balance (USDT)', placeholder: '100000' },
            { key: 'maker_fee', label: 'Maker Fee Rate', placeholder: '0.001' },
            { key: 'taker_fee', label: 'Taker Fee Rate', placeholder: '0.001' },
            { key: 'default_leverage', label: 'Default Leverage', placeholder: '1' },
            { key: 'slippage', label: 'Slippage Rate', placeholder: '0.0005' },
            { key: 'max_leverage', label: 'Max Leverage', placeholder: '125' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="text-xs text-slate-500 mb-1 block">{label}</label>
              <input
                type="number"
                value={form[key] || ''}
                onChange={e => setForm({ ...form, [key]: e.target.value })}
                placeholder={placeholder}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:border-yellow-500"
                step="any"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Risk Management */}
      <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
        <div className="flex items-center gap-3 mb-3">
          <AlertTriangle size={18} className="text-orange-400" />
          <h3 className="text-sm font-semibold">Risk Management</h3>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Max Position Size (% of portfolio)</label>
            <input
              type="number"
              value={form.max_position_size_pct || ''}
              onChange={e => setForm({ ...form, max_position_size_pct: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:border-yellow-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Daily Loss Limit (USDT)</label>
            <input
              type="number"
              value={form.daily_loss_limit || ''}
              onChange={e => setForm({ ...form, daily_loss_limit: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:border-yellow-500"
            />
          </div>
        </div>
      </div>

      {/* API Keys */}
      <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
        <div className="flex items-center gap-3 mb-3">
          <Key size={18} className="text-purple-400" />
          <h3 className="text-sm font-semibold">Binance API Keys</h3>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          API keys are configured via the <code className="bg-slate-800 px-1 rounded">.env</code> file for security.
          Set <code className="bg-slate-800 px-1 rounded">BINANCE_API_KEY</code> and <code className="bg-slate-800 px-1 rounded">BINANCE_API_SECRET</code> there.
        </p>
        <div className="flex items-center gap-2 text-xs">
          <div className={`w-2 h-2 rounded-full ${config?.binance_connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className="text-slate-400">
            Binance: {config?.binance_connected ? 'Connected' : 'Not connected'}
            {config?.binance_status?.trackedPairs > 0 && ` (${config.binance_status.trackedPairs} pairs)`}
          </span>
        </div>
      </div>

      <div className="bg-[#12151a] rounded-lg p-4 border border-slate-800/50">
        <div className="flex items-center gap-3 mb-3">
          <Palette size={18} className="text-emerald-400" />
          <h3 className="text-sm font-semibold">AI Strategy Suggestions</h3>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          OpenAI-powered proposal generation is optional and uses the server-side <code className="bg-slate-800 px-1 rounded">OPENAI_API_KEY</code>.
          The deterministic analyzer and recommender still run even when AI is disabled.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Provider</label>
            <input
              value={form.llm_provider || 'openai'}
              readOnly
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Default Model</label>
            <select
              value={form.llm_model || ''}
              onChange={e => setForm({ ...form, llm_model: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
            >
              {(config?.llm_available_models || []).map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs mt-3">
          <div className={`w-2 h-2 rounded-full ${config?.llm_enabled ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className="text-slate-400">
            OpenAI: {config?.llm_enabled ? 'Configured' : 'Not configured'}
          </span>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        className="w-full py-3 bg-yellow-500 text-black rounded font-semibold text-sm hover:bg-yellow-400 flex items-center justify-center gap-2"
      >
        <Save size={16} />
        Save Settings
      </button>

      {/* Live Mode Confirmation Modal */}
      {showLiveConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowLiveConfirm(false)}>
          <div className="bg-[#12151a] rounded-xl border border-red-500/30 p-6 w-[480px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle size={24} className="text-red-400" />
              <h3 className="text-lg font-bold text-red-400">Enable Live Trading</h3>
            </div>

            <div className="space-y-3 mb-4">
              <p className="text-sm text-slate-300">
                You are about to enable <strong>LIVE TRADING</strong>. This means:
              </p>
              <ul className="text-sm text-slate-400 space-y-1 list-disc list-inside">
                <li>All orders will be executed with <strong className="text-red-400">real money</strong> on Binance</li>
                <li>Losses are permanent and irreversible</li>
                <li>Your Binance API keys must have trading permissions</li>
              </ul>
            </div>

            <div className="mb-4">
              <label className="text-xs text-slate-500 mb-1 block">
                Type <code className="text-red-400">I_UNDERSTAND_REAL_MONEY</code> to confirm:
              </label>
              <input
                type="text"
                value={liveConfirmText}
                onChange={e => setLiveConfirmText(e.target.value)}
                placeholder="I_UNDERSTAND_REAL_MONEY"
                className="w-full bg-slate-800 border border-red-500/30 rounded px-3 py-2 text-sm outline-none focus:border-red-500 font-mono"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowLiveConfirm(false)}
                className="flex-1 py-2.5 bg-slate-800 text-slate-300 rounded font-semibold text-sm hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={confirmLiveMode}
                className="flex-1 py-2.5 bg-red-500 text-white rounded font-semibold text-sm hover:bg-red-600"
              >
                Enable Live Trading
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
