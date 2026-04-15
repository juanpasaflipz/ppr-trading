const API_BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  if (res.headers.get('content-type')?.includes('text/csv')) {
    return res.text();
  }
  return res.json();
}

export const api = {
  // Health
  health: () => request('/health'),

  // Config
  getConfig: () => request('/config'),
  updateConfig: (data) => request('/config', { method: 'PUT', body: JSON.stringify(data) }),

  // Market
  getPairs: () => request('/market/pairs'),
  getTicker: (symbol) => request(`/market/ticker/${symbol}`),
  getTickers: () => request('/market/tickers'),
  getOrderBook: (symbol, limit) => request(`/market/orderbook/${symbol}?limit=${limit || 20}`),
  getCandles: (symbol, interval, limit) => request(`/market/candles/${symbol}?interval=${interval || '1h'}&limit=${limit || 500}`),

  // Portfolio
  getPortfolio: () => request('/portfolio'),
  getPortfolioHistory: () => request('/portfolio/history'),
  transfer: (data) => request('/portfolio/transfer', { method: 'POST', body: JSON.stringify(data) }),

  // Orders
  placeOrder: (data) => request('/orders', { method: 'POST', body: JSON.stringify(data) }),
  getOpenOrders: (marketType) => request(`/orders${marketType ? `?marketType=${marketType}` : ''}`),
  getOrderHistory: (limit) => request(`/orders/history?limit=${limit || 100}`),
  cancelOrder: (id) => request(`/orders/${id}`, { method: 'DELETE' }),

  // Positions
  getPositions: () => request('/positions'),
  closePosition: (id, price) => request(`/positions/${id}/close`, { method: 'POST', body: JSON.stringify({ price }) }),
  adjustLeverage: (id, leverage) => request(`/positions/${id}/leverage`, { method: 'PUT', body: JSON.stringify({ leverage }) }),

  // Trades
  getTrades: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/trades?${qs}`);
  },
  getTradeSummary: () => request('/trades/summary'),
  exportTrades: () => request('/trades/export'),

  // Webhook
  getAlerts: (limit) => request(`/webhook/alerts?limit=${limit || 100}`),

  // Strategies
  getStrategies: (params) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/strategies?${qs}`);
  },
  getStrategy: (id) => request(`/strategies/${id}`),
  refreshStrategies: () => request('/strategies/refresh', { method: 'POST' }),

  // Strategy Lab
  getStrategyLabStrategies: (params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/strategy-lab/strategies${qs ? `?${qs}` : ''}`);
  },
  getStrategyLabStrategy: (id) => request(`/strategy-lab/strategies/${id}`),
  getStrategyLabStrategyFamily: (id) => request(`/strategy-lab/strategies/${id}/family`),
  getStrategyLabFamilyRecommendation: (id, data) => request(`/strategy-lab/strategies/${id}/family/recommendation`, { method: 'POST', body: JSON.stringify(data || {}) }),
  promoteStrategyLabStrategy: (id) => request(`/strategy-lab/strategies/${id}/promote`, { method: 'POST' }),
  archiveStrategyLabStrategy: (id) => request(`/strategy-lab/strategies/${id}/archive`, { method: 'POST' }),
  importStrategyLabStrategy: (data) => request('/strategy-lab/import', { method: 'POST', body: JSON.stringify(data) }),
  evaluateStrategyLabStrategy: (id, data) => request(`/strategy-lab/strategies/${id}/evaluate`, { method: 'POST', body: JSON.stringify(data || {}) }),
  getStrategyLabEvaluations: (id, params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return request(`/strategy-lab/strategies/${id}/evaluations${qs ? `?${qs}` : ''}`);
  },
  getStrategyLabEvaluation: (id) => request(`/strategy-lab/evaluations/${id}`),
  getStrategyLabRecommendations: (data) => request('/strategy-lab/recommendations', { method: 'POST', body: JSON.stringify(data || {}) }),
  getStrategyLabLlmSettings: () => request('/strategy-lab/llm/settings'),
  generateStrategyLabLlmProposals: (data) => request('/strategy-lab/llm/proposals', { method: 'POST', body: JSON.stringify(data || {}) }),
  normalizeTradingViewStrategy: (data) => request('/strategy-lab/import/tradingview/normalize', { method: 'POST', body: JSON.stringify(data || {}) }),
  importTradingViewStrategy: (data) => request('/strategy-lab/import/tradingview', { method: 'POST', body: JSON.stringify(data || {}) }),
  importTradingViewStrategyFamily: (data) => request('/strategy-lab/import/tradingview/family', { method: 'POST', body: JSON.stringify(data || {}) }),
  generateStrategyLabChildren: (id, data) => request(`/strategy-lab/strategies/${id}/generate-children`, { method: 'POST', body: JSON.stringify(data || {}) }),

  // Backtest
  getBacktestStrategies: () => request('/backtest/strategies'),
  runBacktest: (data) => request('/backtest', { method: 'POST', body: JSON.stringify(data) }),
  runArenaBacktest: (data) => request('/backtest/arena', { method: 'POST', body: JSON.stringify(data) }),
  getBacktestResults: () => request('/backtest/results'),
  getBacktestResult: (id) => request(`/backtest/results/${id}`),
};
