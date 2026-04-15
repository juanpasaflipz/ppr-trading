import { getDb } from '../db/database.js';
import { STRATEGY_LAB_TEMPLATES } from './strategyLabTemplates.js';

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function normalizeStrategyInput(input) {
  if (!input?.name?.trim()) {
    throw new Error('Strategy name is required');
  }

  const sourceKind = input.sourceKind || 'manual';
  const style = input.style || 'trend';
  const directionality = input.directionality || 'long_short';
  const status = input.status || 'ready';

  const normalized = {
    slug: input.slug || slugify(input.name),
    name: input.name.trim(),
    sourceKind,
    sourceUrl: input.sourceUrl || null,
    sourceAuthor: input.sourceAuthor || null,
    pineScript: input.pineScript || null,
    familyId: input.familyId || null,
    familyName: input.familyName || null,
    parentStrategyId: input.parentStrategyId || null,
    generation: Number.isFinite(Number(input.generation)) ? Number(input.generation) : 0,
    familyRole: input.familyRole || 'standalone',
    variantLabel: input.variantLabel || null,
    importRunId: input.importRunId || null,
    style,
    directionality,
    status,
    market: {
      assetClass: input.market?.assetClass || 'crypto',
      allowedPairs: input.market?.allowedPairs || [],
      preferredTimeframes: input.market?.preferredTimeframes || [],
    },
    indicators: input.indicators || {},
    rules: input.rules || {},
    notes: {
      hypothesis: input.notes?.hypothesis || '',
      assumptions: input.notes?.assumptions || [],
    },
  };

  if (!normalized.market.allowedPairs.length) {
    normalized.market.allowedPairs = ['BTCUSDT'];
  }
  if (!normalized.market.preferredTimeframes.length) {
    normalized.market.preferredTimeframes = ['1h'];
  }

  return normalized;
}

function mapRow(row) {
  const strategy = JSON.parse(row.strategy_json);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sourceKind: row.source_kind,
    sourceUrl: row.source_url,
    sourceAuthor: row.source_author,
    pineScript: row.pine_script,
    familyId: row.family_id,
    familyName: row.family_name,
    familyActiveStrategyId: row.family_active_strategy_id,
    parentStrategyId: row.parent_strategy_id,
    generation: row.generation ?? 0,
    familyRole: row.family_role,
    variantLabel: row.variant_label,
    importRunId: row.import_run_id,
    style: row.style,
    directionality: row.directionality,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...strategy,
  };
}

function getLatestEvaluationSummary(strategyId) {
  const row = getDb().prepare(`
    SELECT id, summary_json, created_at
    FROM strategy_evaluations
    WHERE strategy_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(strategyId);

  if (!row) return null;

  return {
    evaluationId: row.id,
    createdAt: row.created_at,
    summary: JSON.parse(row.summary_json),
  };
}

class StrategyRegistry {
  constructor() {
    this.insertStmt = null;
    this.updateStmt = null;
  }

  _prepareStatements() {
    const db = getDb();
    if (!this.insertStmt) {
      this.insertStmt = db.prepare(`
        INSERT INTO strategies_v2
        (slug, name, source_kind, source_url, source_author, pine_script, strategy_json, family_id, parent_strategy_id, generation, variant_label, family_role, import_run_id, style, directionality, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      this.updateStmt = db.prepare(`
        UPDATE strategies_v2
        SET name = ?, source_kind = ?, source_url = ?, source_author = ?, pine_script = ?,
            strategy_json = ?, family_id = ?, parent_strategy_id = ?, generation = ?, variant_label = ?, family_role = ?, import_run_id = ?, style = ?, directionality = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE slug = ?
      `);
    }
  }

  ensureFamily(input) {
    if (!input.familyName && !input.familyId) return null;
    const db = getDb();
    if (input.familyId) return input.familyId;

    const existing = db.prepare(`
      SELECT id
      FROM strategy_families
      WHERE name = ? AND COALESCE(source_url, '') = COALESCE(?, '')
      ORDER BY id DESC
      LIMIT 1
    `).get(input.familyName, input.sourceUrl || null);
    if (existing) return existing.id;

    const created = db.prepare(`
      INSERT INTO strategy_families
      (name, source_kind, source_url, source_author, import_run_id, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      input.familyName,
      input.sourceKind || 'manual',
      input.sourceUrl || null,
      input.sourceAuthor || null,
      input.importRunId || null
    );
    return Number(created.lastInsertRowid);
  }

  seedDefaults() {
    for (const template of STRATEGY_LAB_TEMPLATES) {
      this.upsertStrategy({ ...template, sourceKind: template.sourceKind || 'internal' });
    }
  }

  upsertStrategy(input) {
    this._prepareStatements();
    const db = getDb();
    const normalized = normalizeStrategyInput(input);
    const familyId = this.ensureFamily(normalized);
    const payload = JSON.stringify({
      market: normalized.market,
      classification: {
        style: normalized.style,
        directionality: normalized.directionality,
      },
      indicators: normalized.indicators,
      rules: normalized.rules,
      notes: normalized.notes,
    });

    const existing = db.prepare('SELECT id FROM strategies_v2 WHERE slug = ?').get(normalized.slug);
    if (existing) {
      this.updateStmt.run(
        normalized.name,
        normalized.sourceKind,
        normalized.sourceUrl,
        normalized.sourceAuthor,
        normalized.pineScript,
        payload,
        familyId,
        normalized.parentStrategyId,
        normalized.generation,
        normalized.variantLabel,
        normalized.familyRole,
        normalized.importRunId,
        normalized.style,
        normalized.directionality,
        normalized.status,
        normalized.slug
      );
      return this.getStrategyBySlug(normalized.slug);
    }

    this.insertStmt.run(
      normalized.slug,
      normalized.name,
      normalized.sourceKind,
      normalized.sourceUrl,
      normalized.sourceAuthor,
      normalized.pineScript,
      payload,
      familyId,
      normalized.parentStrategyId,
      normalized.generation,
      normalized.variantLabel,
      normalized.familyRole,
      normalized.importRunId,
      normalized.style,
      normalized.directionality,
      normalized.status
    );

    return this.getStrategyBySlug(normalized.slug);
  }

  importManualStrategy(input) {
    return this.upsertStrategy({
      ...input,
      sourceKind: input.sourceKind || 'manual',
      status: input.status || 'ready',
    });
  }

  listStrategies(filters = {}) {
    const db = getDb();
    let query = `
      SELECT s.*, f.name AS family_name
           , f.active_strategy_id AS family_active_strategy_id
      FROM strategies_v2 s
      LEFT JOIN strategy_families f ON f.id = s.family_id
      WHERE 1=1
    `;
    const params = [];

    if (filters.status) {
      query += ' AND s.status = ?';
      params.push(filters.status);
    }
    if (filters.style) {
      query += ' AND s.style = ?';
      params.push(filters.style);
    }
    if (filters.sourceKind) {
      query += ' AND s.source_kind = ?';
      params.push(filters.sourceKind);
    }

    query += ' ORDER BY COALESCE(s.family_id, s.id) DESC, CASE WHEN s.family_role = \'parent\' THEN 0 ELSE 1 END, s.updated_at DESC, s.created_at DESC';
    const rows = getDb().prepare(query).all(...params);
    return rows.map(mapRow);
  }

  getStrategy(id) {
    const row = getDb().prepare(`
      SELECT s.*, f.name AS family_name
           , f.active_strategy_id AS family_active_strategy_id
      FROM strategies_v2 s
      LEFT JOIN strategy_families f ON f.id = s.family_id
      WHERE s.id = ?
    `).get(id);
    return row ? mapRow(row) : null;
  }

  getStrategyBySlug(slug) {
    const row = getDb().prepare(`
      SELECT s.*, f.name AS family_name
           , f.active_strategy_id AS family_active_strategy_id
      FROM strategies_v2 s
      LEFT JOIN strategy_families f ON f.id = s.family_id
      WHERE s.slug = ?
    `).get(slug);
    return row ? mapRow(row) : null;
  }

  getStrategyFamily(strategyId) {
    const strategy = this.getStrategy(strategyId);
    if (!strategy) return null;

    const rows = strategy.familyId
      ? getDb().prepare(`
          SELECT s.*, f.name AS family_name
               , f.active_strategy_id AS family_active_strategy_id
          FROM strategies_v2 s
          LEFT JOIN strategy_families f ON f.id = s.family_id
          WHERE s.family_id = ?
          ORDER BY s.generation ASC, CASE WHEN s.family_role = 'parent' THEN 0 ELSE 1 END, s.updated_at DESC, s.created_at DESC
        `).all(strategy.familyId)
      : getDb().prepare(`
          SELECT s.*, f.name AS family_name
               , f.active_strategy_id AS family_active_strategy_id
          FROM strategies_v2 s
          LEFT JOIN strategy_families f ON f.id = s.family_id
          WHERE s.id = ?
        `).all(strategyId);

    const members = rows.map((row) => {
      const mapped = mapRow(row);
      return {
        ...mapped,
        latestEvaluation: getLatestEvaluationSummary(mapped.id),
      };
    });

    const rankedMembers = [...members].sort((a, b) => {
      const aScore = a.latestEvaluation?.summary?.scores?.total ?? -1;
      const bScore = b.latestEvaluation?.summary?.scores?.total ?? -1;
      return bScore - aScore;
    });

    return {
      familyId: strategy.familyId,
      familyName: strategy.familyName || strategy.name,
      activeStrategyId: strategy.familyActiveStrategyId || rankedMembers[0]?.id || strategy.id,
      sourceKind: strategy.sourceKind,
      sourceUrl: strategy.sourceUrl,
      members,
      bestMemberId: rankedMembers[0]?.id || strategy.id,
      generations: [...new Set(members.map((member) => member.generation || 0))].sort((a, b) => a - b),
    };
  }

  promoteStrategy(strategyId) {
    const strategy = this.getStrategy(strategyId);
    if (!strategy) throw new Error('Strategy not found');
    if (!strategy.familyId) throw new Error('Strategy is not part of a family');

    getDb().prepare(`
      UPDATE strategy_families
      SET active_strategy_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(strategy.id, strategy.familyId);

    return this.getStrategyFamily(strategy.id);
  }

  archiveStrategy(strategyId) {
    const strategy = this.getStrategy(strategyId);
    if (!strategy) throw new Error('Strategy not found');

    getDb().prepare(`
      UPDATE strategies_v2
      SET status = 'archived', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(strategy.id);

    if (strategy.familyId && strategy.familyActiveStrategyId === strategy.id) {
      const replacement = getDb().prepare(`
        SELECT s.id, f.name AS family_name, f.active_strategy_id AS family_active_strategy_id
        FROM strategies_v2 s
        LEFT JOIN strategy_families f ON f.id = s.family_id
        WHERE s.family_id = ? AND s.status != 'archived'
        ORDER BY s.generation DESC, s.updated_at DESC
        LIMIT 1
      `).get(strategy.familyId);
      getDb().prepare(`
        UPDATE strategy_families
        SET active_strategy_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(replacement?.id || null, strategy.familyId);
    }

    return this.getStrategyFamily(strategy.familyId ? strategy.id : strategyId);
  }
}

const strategyRegistry = new StrategyRegistry();
export default strategyRegistry;
export { normalizeStrategyInput, slugify };
