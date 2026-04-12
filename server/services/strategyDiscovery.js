import { getDb } from '../db/database.js';

class StrategyDiscovery {
  getStrategies(filters = {}) {
    const db = getDb();
    let query = 'SELECT * FROM strategies WHERE 1=1';
    const params = [];

    if (filters.type) {
      query += ' AND strategy_type = ?';
      params.push(filters.type);
    }
    if (filters.minWinRate) {
      query += ' AND win_rate >= ?';
      params.push(parseFloat(filters.minWinRate));
    }
    if (filters.minProfitFactor) {
      query += ' AND profit_factor >= ?';
      params.push(parseFloat(filters.minProfitFactor));
    }
    if (filters.maxDrawdown) {
      query += ' AND max_drawdown <= ?';
      params.push(parseFloat(filters.maxDrawdown));
    }

    const sortOptions = {
      score: 'composite_score DESC',
      win_rate: 'win_rate DESC',
      newest: 'discovered_at DESC',
      likes: 'likes DESC',
      profit_factor: 'profit_factor DESC',
    };
    query += ` ORDER BY ${sortOptions[filters.sort] || 'composite_score DESC'}`;

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(parseInt(filters.limit));
    }

    return db.prepare(query).all(...params);
  }

  getStrategy(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM strategies WHERE id = ?').get(id);
  }

  addStrategy(data) {
    const db = getDb();
    const score = this._calcScore(data);

    const result = db.prepare(`
      INSERT INTO strategies (name, author, description, source_url, pine_script, strategy_type,
        win_rate, profit_factor, max_drawdown, net_profit_pct, likes, composite_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name, data.author, data.description, data.sourceUrl, data.pineScript,
      data.strategyType, data.winRate, data.profitFactor, data.maxDrawdown,
      data.netProfitPct, data.likes || 0, score
    );

    return db.prepare('SELECT * FROM strategies WHERE id = ?').get(result.lastInsertRowid);
  }

  _calcScore(data) {
    return (
      ((data.winRate || 0) * 0.3) +
      ((data.profitFactor || 0) * 0.25) +
      ((1 - (data.maxDrawdown || 0)) * 0.25) +
      (Math.log((data.likes || 0) + 1) / Math.log(20000) * 0.2)
    );
  }

  async refreshStrategies() {
    // In a production system, this would scrape TradingView
    // For now, recalculate scores for existing strategies
    const db = getDb();
    const strategies = db.prepare('SELECT * FROM strategies').all();

    for (const s of strategies) {
      const score = this._calcScore({
        winRate: s.win_rate,
        profitFactor: s.profit_factor,
        maxDrawdown: s.max_drawdown,
        likes: s.likes,
      });
      db.prepare('UPDATE strategies SET composite_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(parseFloat(score.toFixed(4)), s.id);
    }

    return { refreshed: strategies.length };
  }
}

const strategyDiscovery = new StrategyDiscovery();
export default strategyDiscovery;
