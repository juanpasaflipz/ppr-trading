import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  BarChart3, Wallet, History, Lightbulb, FlaskConical, Bell, Settings,
  Wifi, WifiOff, Zap, TrendingUp, BrainCircuit
} from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import { useToast } from './hooks/useToast';
import Toast from './components/Toast';
import { api } from './lib/api';
import { formatUSD } from './lib/format';

import TradingTerminal from './pages/TradingTerminal';
import Portfolio from './pages/Portfolio';
import TradeHistory from './pages/TradeHistory';
import StrategyDiscovery from './pages/StrategyDiscovery';
import Backtesting from './pages/Backtesting';
import AlertsWebhooks from './pages/AlertsWebhooks';
import StrategyLab from './pages/StrategyLab';
import SettingsPage from './pages/Settings';

export const AppContext = createContext();

export function useApp() {
  return useContext(AppContext);
}

const TABS = [
  { id: 'terminal', label: 'Terminal', icon: BarChart3 },
  { id: 'portfolio', label: 'Portfolio', icon: Wallet },
  { id: 'history', label: 'History', icon: History },
  { id: 'strategies', label: 'Strategies', icon: Lightbulb },
  { id: 'lab', label: 'Strategy Lab', icon: BrainCircuit },
  { id: 'backtest', label: 'Backtest', icon: FlaskConical },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('terminal');
  const [portfolio, setPortfolio] = useState(null);
  const [config, setConfig] = useState(null);
  const ws = useWebSocket();
  const { toasts, addToast, removeToast } = useToast();

  useEffect(() => {
    api.getPortfolio().then(setPortfolio).catch(() => {});
    api.getConfig().then(setConfig).catch(() => {});
    const interval = setInterval(() => {
      api.getPortfolio().then(setPortfolio).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '1') setActiveTab('terminal');
      if (e.key === '2') setActiveTab('portfolio');
      if (e.key === '3') setActiveTab('history');
      if (e.key === '4') setActiveTab('strategies');
      if (e.key === '5') setActiveTab('lab');
      if (e.key === '6') setActiveTab('backtest');
      if (e.key === '7') setActiveTab('alerts');
      if (e.key === '8') setActiveTab('settings');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const ctx = { ws, addToast, portfolio, setPortfolio, config, setConfig };

  return (
    <AppContext.Provider value={ctx}>
      <div className="h-screen flex flex-col bg-[#0b0e11] text-white font-['Inter',sans-serif]">
        {/* Top Bar */}
        <header className="flex items-center justify-between px-4 py-2 bg-[#12151a] border-b border-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Zap size={20} className="text-yellow-400" />
              <span className="font-bold text-lg tracking-tight">PaperTrade Pro</span>
            </div>
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold ${
              config?.trading_mode === 'live'
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
            }`}>
              {config?.trading_mode === 'live' ? 'LIVE' : 'PAPER'}
            </div>
          </div>

          <div className="flex items-center gap-6">
            {portfolio && (
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-slate-500 mr-2">Balance</span>
                  <span className="font-semibold">{formatUSD(portfolio.totalValue)}</span>
                </div>
                <div>
                  <span className="text-slate-500 mr-2">PnL</span>
                  <span className={`font-semibold ${portfolio.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatUSD(portfolio.totalPnl)} ({portfolio.totalPnlPct >= 0 ? '+' : ''}{portfolio.totalPnlPct?.toFixed(2)}%)
                  </span>
                </div>
              </div>
            )}
            <div className={`flex items-center gap-1.5 text-xs ${ws.connected ? 'text-emerald-400' : 'text-red-400'}`}>
              {ws.connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              {ws.connected ? 'Live' : 'Offline'}
            </div>
          </div>
        </header>

        {/* Tab Bar */}
        <nav className="flex bg-[#12151a] border-b border-slate-800/50 px-2">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                  isActive
                    ? 'text-yellow-400 border-yellow-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200 hover:border-slate-600'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-auto">
          {activeTab === 'terminal' && <TradingTerminal />}
          {activeTab === 'portfolio' && <Portfolio />}
          {activeTab === 'history' && <TradeHistory />}
          {activeTab === 'strategies' && <StrategyDiscovery />}
          {activeTab === 'lab' && <StrategyLab />}
          {activeTab === 'backtest' && <Backtesting />}
          {activeTab === 'alerts' && <AlertsWebhooks />}
          {activeTab === 'settings' && <SettingsPage />}
        </main>

        <Toast toasts={toasts} removeToast={removeToast} />
      </div>
    </AppContext.Provider>
  );
}
