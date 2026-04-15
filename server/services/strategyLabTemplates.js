export const STRATEGY_LAB_TEMPLATES = [
  {
    name: 'Smart Money Concepts Core',
    sourceKind: 'internal',
    sourceAuthor: 'PaperTrade Pro',
    style: 'market_structure',
    directionality: 'long_short',
    sourceUrl: null,
    notes: {
      hypothesis: 'Market structure continuation after break of structure and pullback.',
      assumptions: [
        'Break of structure captures directional intent',
        'Liquidity sweeps improve entry quality',
      ],
    },
    market: {
      assetClass: 'crypto',
      allowedPairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      preferredTimeframes: ['1h', '4h'],
    },
    indicators: {
      marketStructure: { lookback: 20 },
      atr: { period: 14 },
    },
    rules: {
      entry: 'Enter on BOS + pullback into displacement zone with ATR confirmation.',
      exit: 'Exit at opposing structure break or risk multiple target.',
      filters: ['Avoid low-volume ranging sessions'],
      risk: { stopLossPct: 0.018, takeProfitPct: 0.05 },
    },
  },
  {
    name: 'SuperTrend WaveTrend Combo',
    sourceKind: 'internal',
    sourceAuthor: 'PaperTrade Pro',
    style: 'trend',
    directionality: 'long_short',
    sourceUrl: null,
    notes: {
      hypothesis: 'Trend-following entries improve when trend filter and momentum oscillator align.',
      assumptions: [
        'Trend persistence exists on 1h-4h crypto charts',
        'Momentum pullbacks resolve in trend direction more often than not',
      ],
    },
    market: {
      assetClass: 'crypto',
      allowedPairs: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'],
      preferredTimeframes: ['1h', '4h'],
    },
    indicators: {
      supertrend: { period: 10, multiplier: 3 },
      wavetrend: { channelLength: 10, averageLength: 21 },
    },
    rules: {
      entry: 'Enter when SuperTrend direction and WaveTrend cross align.',
      exit: 'Exit on trend flip or momentum exhaustion.',
      filters: ['Skip compressed low-ATR conditions'],
      risk: { stopLossPct: 0.02, takeProfitPct: 0.06 },
    },
  },
  {
    name: 'Bollinger Squeeze Breakout',
    sourceKind: 'internal',
    sourceAuthor: 'PaperTrade Pro',
    style: 'breakout',
    directionality: 'long_short',
    sourceUrl: null,
    notes: {
      hypothesis: 'Volatility contraction precedes directional expansion.',
      assumptions: [
        'Band compression predicts a move',
        'Breakouts need volume confirmation',
      ],
    },
    market: {
      assetClass: 'crypto',
      allowedPairs: ['BTCUSDT', 'ETHUSDT', 'XRPUSDT'],
      preferredTimeframes: ['15m', '1h'],
    },
    indicators: {
      bollinger: { period: 20, stdDev: 2 },
      atr: { period: 14 },
      volume: { lookback: 20 },
    },
    rules: {
      entry: 'Enter on band expansion breakout with volume confirmation.',
      exit: 'Exit on failed expansion or mean reversion into band midline.',
      filters: ['Require ATR percentile uplift'],
      risk: { stopLossPct: 0.0175, takeProfitPct: 0.045 },
    },
  },
  {
    name: 'RSI MACD Confluence',
    sourceKind: 'internal',
    sourceAuthor: 'PaperTrade Pro',
    style: 'swing',
    directionality: 'long_only',
    sourceUrl: null,
    notes: {
      hypothesis: 'Momentum reversals are stronger when oscillator and trend impulse agree.',
      assumptions: [
        'Oversold conditions revert when broader impulse turns positive',
        'MACD helps avoid early RSI-only entries',
      ],
    },
    market: {
      assetClass: 'crypto',
      allowedPairs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      preferredTimeframes: ['4h'],
    },
    indicators: {
      rsi: { period: 14 },
      macd: { fast: 12, slow: 26, signal: 9 },
    },
    rules: {
      entry: 'Enter when RSI exits weakness and MACD crosses bullish.',
      exit: 'Exit on RSI overextension or bearish MACD cross.',
      filters: ['Avoid parabolic trend exhaustion'],
      risk: { stopLossPct: 0.0225, takeProfitPct: 0.055 },
    },
  },
  {
    name: 'VWAP Volume Profile Reversion',
    sourceKind: 'internal',
    sourceAuthor: 'PaperTrade Pro',
    style: 'mean_reversion',
    directionality: 'long_short',
    sourceUrl: null,
    notes: {
      hypothesis: 'Intraday deviations from fair value revert when volume acceptance is absent.',
      assumptions: [
        'VWAP is an anchor for intraday fair value',
        'Extreme deviations without follow-through revert',
      ],
    },
    market: {
      assetClass: 'crypto',
      allowedPairs: ['BTCUSDT', 'ETHUSDT'],
      preferredTimeframes: ['5m', '15m'],
    },
    indicators: {
      vwap: { session: 'daily' },
      volumeProfile: { bins: 24 },
      zscore: { lookback: 40 },
    },
    rules: {
      entry: 'Fade stretched moves away from VWAP when volume acceptance fails.',
      exit: 'Exit on return to VWAP or rejection of reversion.',
      filters: ['Disable during breakout expansion regime'],
      risk: { stopLossPct: 0.01, takeProfitPct: 0.02 },
    },
  },
];
