import strategyRegistry from './strategyRegistry.js';
import openaiService from './openaiService.js';
import { getDb } from '../db/database.js';
import strategyAnalyzer from './strategyAnalyzer.js';
import strategyRecommender from './strategyRecommender.js';

function parseMetaTag(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function normalizeList(values, fallback = []) {
  if (!Array.isArray(values)) return fallback;
  const list = values.map((value) => String(value || '').trim()).filter(Boolean);
  return list.length ? list : fallback;
}

function normalizeImportedStrategy(base = {}) {
  return {
    name: base.name || 'Imported TradingView Strategy',
    sourceKind: 'tradingview',
    sourceUrl: base.sourceUrl || null,
    sourceAuthor: base.sourceAuthor || null,
    pineScript: base.pineScript || null,
    style: base.style || 'trend',
    directionality: base.directionality || 'long_short',
    market: {
      assetClass: 'crypto',
      allowedPairs: normalizeList(base.market?.allowedPairs, ['BTCUSDT']),
      preferredTimeframes: normalizeList(base.market?.preferredTimeframes, ['1h']),
    },
    indicators: base.indicators || {},
    rules: {
      entry: base.rules?.entry || '',
      exit: base.rules?.exit || '',
      filters: Array.isArray(base.rules?.filters) ? base.rules.filters : [],
      risk: {
        stopLossPct: Number(base.rules?.risk?.stopLossPct || 0.02),
        takeProfitPct: Number(base.rules?.risk?.takeProfitPct || 0.05),
      },
    },
    notes: {
      hypothesis: base.notes?.hypothesis || '',
      assumptions: normalizeList(base.notes?.assumptions, []),
    },
  };
}

function normalizeVariantList(variants = [], context = {}) {
  const normalized = variants
    .map((variant, index) => ({
      label: variant?.label || `Variant ${index + 1}`,
      summary: variant?.summary || '',
      strategy: normalizeImportedStrategy({
        ...variant?.strategy,
        sourceUrl: context.sourceUrl || variant?.strategy?.sourceUrl || null,
        sourceAuthor: variant?.strategy?.sourceAuthor || context.sourceAuthor || null,
        pineScript: context.pineScript || variant?.strategy?.pineScript || null,
      }),
    }))
    .filter((variant) => variant.strategy?.name);

  return normalized.length ? normalized : [{
    label: 'Primary',
    summary: '',
    strategy: normalizeImportedStrategy(context),
  }];
}

function buildDeterministicChildVariants(strategy) {
  const stop = Number(strategy.rules?.risk?.stopLossPct || 0.02);
  const take = Number(strategy.rules?.risk?.takeProfitPct || 0.05);
  const timeframes = normalizeList(strategy.market?.preferredTimeframes, ['1h']);
  const currentTf = timeframes[0] || '1h';
  const slowerTf = currentTf === '15m' ? '1h' : currentTf === '1h' ? '4h' : currentTf;
  const fasterTf = currentTf === '4h' ? '1h' : currentTf === '1h' ? '15m' : currentTf;

  return [
    {
      label: 'Gen2 Conservative',
      summary: 'Lower risk and slower confirmation.',
      strategy: {
        ...strategy,
        market: { ...strategy.market, preferredTimeframes: [slowerTf] },
        rules: {
          ...strategy.rules,
          risk: {
            stopLossPct: Math.min(stop * 1.1, 0.04),
            takeProfitPct: Math.max(take * 0.9, stop * 1.8),
          },
        },
        notes: {
          ...strategy.notes,
          hypothesis: `${strategy.notes?.hypothesis || ''} Child variant tuned for smoother equity.`.trim(),
        },
      },
    },
    {
      label: 'Gen2 Balanced',
      summary: 'Preserve core logic with cleaner reward-to-risk.',
      strategy: {
        ...strategy,
        rules: {
          ...strategy.rules,
          risk: {
            stopLossPct: stop,
            takeProfitPct: Math.max(take, stop * 2.3),
          },
        },
      },
    },
    {
      label: 'Gen2 Aggressive',
      summary: 'Faster execution and wider payoff target.',
      strategy: {
        ...strategy,
        market: { ...strategy.market, preferredTimeframes: [fasterTf] },
        rules: {
          ...strategy.rules,
          risk: {
            stopLossPct: Math.max(stop * 0.95, 0.008),
            takeProfitPct: Math.max(take * 1.25, stop * 2.8),
          },
        },
        notes: {
          ...strategy.notes,
          hypothesis: `${strategy.notes?.hypothesis || ''} Child variant tuned for higher upside.`.trim(),
        },
      },
    },
  ];
}

class StrategyImportService {
  persistImportRun(payload) {
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO strategy_import_runs
      (source_kind, source_url, source_author, model, raw_input_json, metadata_json, normalization_json, selected_variant_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.sourceKind,
      payload.sourceUrl || null,
      payload.sourceAuthor || null,
      payload.model || null,
      JSON.stringify(payload.rawInput || {}),
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      payload.normalization ? JSON.stringify(payload.normalization) : null,
      payload.selectedVariantIndex ?? null
    );

    return Number(result.lastInsertRowid);
  }

  async fetchTradingViewMetadata(sourceUrl) {
    if (!sourceUrl) throw new Error('TradingView URL is required');

    let parsedUrl;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      throw new Error('Invalid TradingView URL');
    }

    if (!parsedUrl.hostname.includes('tradingview.com')) {
      throw new Error('Only TradingView URLs are supported');
    }

    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PaperTradePro/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`TradingView fetch failed with ${response.status}`);
    }

    const html = await response.text();
    const title = parseMetaTag(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"]+)["']/i,
      /<title>([^<]+)<\/title>/i,
    ]);
    const description = parseMetaTag(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"]+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)["']/i,
    ]);
    const author = parseMetaTag(html, [
      /"authorUsername":"([^"]+)"/i,
      /<meta[^>]+name=["']author["'][^>]+content=["']([^"]+)["']/i,
    ]);

    return {
      sourceUrl,
      title,
      description,
      author,
      fetchedAt: new Date().toISOString(),
    };
  }

  async normalizeTradingView(payload = {}) {
    const metadata = payload.sourceUrl ? await this.fetchTradingViewMetadata(payload.sourceUrl) : null;
    const sourceContext = {
      name: payload.name || metadata?.title || 'Imported TradingView Strategy',
      sourceUrl: payload.sourceUrl,
      sourceAuthor: payload.sourceAuthor || metadata?.author || null,
      pineScript: payload.pineScript || null,
      notes: {
        hypothesis: payload.hypothesis || metadata?.description || '',
        assumptions: payload.assumptions || [],
      },
    };

    if (!openaiService.isConfigured()) {
      const fallback = normalizeImportedStrategy(sourceContext);
      const variants = [{
        label: 'Primary',
        summary: 'Fallback normalization based on metadata and pasted notes.',
        strategy: fallback,
      }];
      const importRunId = this.persistImportRun({
        sourceKind: 'tradingview',
        sourceUrl: payload.sourceUrl,
        sourceAuthor: sourceContext.sourceAuthor,
        rawInput: payload,
        metadata,
        normalization: { primary: fallback, variants },
      });

      return {
        importRunId,
        normalized: fallback,
        variants,
        metadata,
        usedLlm: false,
      };
    }

    const { model, parsed } = await openaiService.createResponse({
      model: payload.model,
      instructions: [
        'You normalize TradingView strategy inputs into a strict internal JSON shape.',
        'Only use information present in the provided source URL metadata, pine script, and user notes.',
        'Do not invent performance claims.',
        'Infer strategy style, directionality, indicative indicators, timeframe fit, and concise rules when possible.',
        'Return JSON with keys: normalizedStrategy, variants, importNotes.',
        'normalizedStrategy must include: name, style, directionality, sourceAuthor, market, indicators, rules, notes.',
        'variants must be an array with 2-4 interpretation variants. Each variant needs: label, summary, strategy.',
        'Variant labels should reflect distinct profiles like conservative, balanced, aggressive, or faster timeframe.',
      ].join(' '),
      input: JSON.stringify({
        task: 'Normalize a TradingView strategy into the PaperTrade Pro internal strategy format.',
        metadata,
        userInput: {
          name: payload.name || null,
          sourceAuthor: payload.sourceAuthor || null,
          pineScript: payload.pineScript || null,
          notes: payload.notes || null,
          hypothesis: payload.hypothesis || null,
        },
      }),
    });

    const normalized = normalizeImportedStrategy({
      ...parsed.normalizedStrategy,
      sourceUrl: payload.sourceUrl || metadata?.sourceUrl || null,
      sourceAuthor: parsed.normalizedStrategy?.sourceAuthor || payload.sourceAuthor || metadata?.author || null,
      pineScript: payload.pineScript || null,
    });
    const variants = normalizeVariantList(parsed.variants, {
      ...sourceContext,
      sourceAuthor: normalized.sourceAuthor,
    });
    const importRunId = this.persistImportRun({
      sourceKind: 'tradingview',
      sourceUrl: payload.sourceUrl,
      sourceAuthor: normalized.sourceAuthor,
      model,
      rawInput: payload,
      metadata,
      normalization: {
        primary: normalized,
        variants,
        importNotes: parsed.importNotes || '',
      },
    });

    return {
      importRunId,
      model,
      normalized,
      variants,
      metadata,
      importNotes: parsed.importNotes || '',
      usedLlm: true,
    };
  }

  importManual(payload) {
    const strategy = strategyRegistry.importManualStrategy(payload);

    return {
      imported: true,
      strategy,
      importType: 'manual',
    };
  }

  async importTradingView(payload = {}) {
    const result = await this.normalizeTradingView(payload);
    const selectedVariantIndex = Number.isInteger(payload.selectedVariantIndex) ? payload.selectedVariantIndex : 0;
    const selectedVariant = result.variants?.[selectedVariantIndex] || result.variants?.[0];
    const strategy = strategyRegistry.importManualStrategy({
      ...(selectedVariant?.strategy || result.normalized),
      sourceKind: 'tradingview',
      familyName: result.normalized.name,
      generation: 0,
      familyRole: 'parent',
      variantLabel: selectedVariant?.label || 'Primary',
      importRunId: result.importRunId,
    });
    this.persistImportRun({
      sourceKind: 'tradingview',
      sourceUrl: payload.sourceUrl,
      sourceAuthor: strategy.sourceAuthor,
      model: result.model || null,
      rawInput: payload,
      metadata: result.metadata,
      normalization: {
        primary: result.normalized,
        variants: result.variants,
        importNotes: result.importNotes || '',
      },
      selectedVariantIndex,
    });

    return {
      imported: true,
      importType: 'tradingview',
      strategy,
      metadata: result.metadata,
      variants: result.variants,
      selectedVariantIndex,
      importNotes: result.importNotes || '',
      model: result.model || null,
      usedLlm: result.usedLlm,
    };
  }

  async importTradingViewFamily(payload = {}) {
    const normalizedResult = await this.normalizeTradingView(payload);
    const variants = normalizedResult.variants?.length
      ? normalizedResult.variants
      : [{ label: 'Primary', summary: '', strategy: normalizedResult.normalized }];
    const familyName = normalizedResult.normalized.name;

    const importedStrategies = [];
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      const strategy = strategyRegistry.importManualStrategy({
        ...variant.strategy,
        name: variants.length > 1 ? `${variant.strategy.name} (${variant.label})` : variant.strategy.name,
        sourceKind: 'tradingview',
        familyName,
        generation: 0,
        familyRole: i === 0 ? 'parent' : 'sibling',
        variantLabel: variant.label,
        importRunId: normalizedResult.importRunId,
        notes: {
          ...(variant.strategy.notes || {}),
          assumptions: [
            ...normalizeList(variant.strategy.notes?.assumptions || [], []),
            `Import variant: ${variant.label}`,
          ],
        },
      });
      importedStrategies.push({
        index: i,
        label: variant.label,
        summary: variant.summary,
        strategy,
      });
    }

    const evaluationInput = {
      startDate: payload.startDate,
      endDate: payload.endDate,
    };

    const analyzed = [];
    for (const item of importedStrategies) {
      const evaluation = await strategyAnalyzer.evaluateStrategy(item.strategy.id, evaluationInput);
      analyzed.push({
        ...item,
        evaluationId: evaluation.id,
        evaluation,
      });
    }

    const ranked = strategyRecommender.rankStrategiesByProfile(
      importedStrategies.map((item) => item.strategy),
      payload.profile || {}
    );

    const best = ranked[0];
    const bestImported = analyzed.find((item) => item.strategy.id === best?.strategyId) || analyzed[0];

    return {
      imported: true,
      importType: 'tradingview_family',
      importRunId: normalizedResult.importRunId,
      model: normalizedResult.model || null,
      usedLlm: normalizedResult.usedLlm,
      metadata: normalizedResult.metadata,
      importNotes: normalizedResult.importNotes || '',
      variants: analyzed.map((item) => ({
        index: item.index,
        label: item.label,
        summary: item.summary,
        strategy: item.strategy,
        evaluationId: item.evaluationId,
        score: ranked.find((entry) => entry.strategyId === item.strategy.id)?.score || null,
      })),
      bestVariant: bestImported ? {
        strategyId: bestImported.strategy.id,
        evaluationId: bestImported.evaluationId,
        label: bestImported.label,
        score: ranked.find((entry) => entry.strategyId === bestImported.strategy.id)?.score || null,
      } : null,
      rankings: ranked,
    };
  }

  async generateNextGenerationVariants(payload = {}) {
    const baseStrategy = strategyRegistry.getStrategy(Number(payload.strategyId));
    if (!baseStrategy) throw new Error('Base strategy not found');
    const nextGeneration = Number(baseStrategy.generation || 0) + 1;

    let childVariants = [];
    let model = null;

    if (openaiService.isConfigured()) {
      const response = await openaiService.createResponse({
        model: payload.model,
        instructions: [
          'Generate 2-3 child strategy variants from the provided base strategy.',
          'Keep the same overall style and asset class.',
          'Return JSON with key variants.',
          'Each variant needs: label, summary, strategy.',
          'strategy must include market, indicators, rules, notes, style, directionality, name.',
          'Do not invent performance claims.',
        ].join(' '),
        input: JSON.stringify({
          task: 'Create next-generation child variants from the current best sibling.',
          profile: payload.profile || {},
          baseStrategy,
        }),
      });
      model = response.model;
      childVariants = normalizeVariantList(response.parsed.variants, {
        sourceUrl: baseStrategy.sourceUrl,
        sourceAuthor: baseStrategy.sourceAuthor,
        pineScript: baseStrategy.pineScript,
      });
    } else {
      childVariants = buildDeterministicChildVariants(baseStrategy).map((variant) => ({
        ...variant,
        strategy: normalizeImportedStrategy({
          ...variant.strategy,
          sourceUrl: baseStrategy.sourceUrl,
          sourceAuthor: baseStrategy.sourceAuthor,
          pineScript: baseStrategy.pineScript,
        }),
      }));
    }

    const importedChildren = [];
    for (const [index, variant] of childVariants.entries()) {
      const strategy = strategyRegistry.importManualStrategy({
        ...variant.strategy,
        name: `${baseStrategy.familyName || baseStrategy.name} (${variant.label})`,
        sourceKind: baseStrategy.sourceKind,
        familyId: baseStrategy.familyId,
        familyName: baseStrategy.familyName || baseStrategy.name,
        parentStrategyId: baseStrategy.id,
        generation: nextGeneration,
        familyRole: 'sibling',
        variantLabel: variant.label,
        notes: {
          ...(variant.strategy.notes || {}),
          assumptions: [
            ...normalizeList(variant.strategy.notes?.assumptions || [], []),
            `Generated from base sibling ${baseStrategy.id}`,
          ],
        },
      });
      const evaluation = await strategyAnalyzer.evaluateStrategy(strategy.id, {
        startDate: payload.startDate,
        endDate: payload.endDate,
      });
      importedChildren.push({
        index,
        label: variant.label,
        summary: variant.summary,
        strategy,
        evaluationId: evaluation.id,
      });
    }

    const rankedChildren = strategyRecommender.rankStrategiesByProfile(
      importedChildren.map((item) => item.strategy),
      payload.profile || {}
    );

    return {
      generated: true,
      model,
      baseStrategyId: baseStrategy.id,
      familyId: baseStrategy.familyId,
      children: importedChildren.map((item) => ({
        ...item,
        score: rankedChildren.find((entry) => entry.strategyId === item.strategy.id)?.score || null,
      })),
      bestChild: rankedChildren[0] || null,
    };
  }
}

const strategyImportService = new StrategyImportService();
export default strategyImportService;
