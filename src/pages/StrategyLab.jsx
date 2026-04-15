import React, { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BrainCircuit, Download, FlaskConical, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { useApp } from '../App';
import { formatDate, formatDateShort, formatNumber, formatPercent, formatUSD, pnlColor } from '../lib/format';

const EMPTY_FORM = {
  name: '',
  importMode: 'tradingview',
  style: 'trend',
  directionality: 'long_short',
  sourceUrl: '',
  sourceAuthor: '',
  allowedPairs: 'BTCUSDT,ETHUSDT',
  preferredTimeframes: '1h,4h',
  pineScript: '',
  entry: '',
  exit: '',
  hypothesis: '',
  assumptions: '',
};

const DEFAULT_ANALYZER_FORM = {
  symbol: 'BTCUSDT',
  timeframe: '1h',
  startDate: '2024-01-01',
  endDate: '2024-12-31',
};

const DEFAULT_PROFILE = {
  riskLevel: 'balanced',
  timeframePreference: 'intraday',
  objective: 'consistency',
};

function normalizeEvaluation(evaluation) {
  if (!evaluation) return null;

  if (evaluation.summary) {
    return {
      id: evaluation.id,
      createdAt: evaluation.createdAt,
      equityCurve: evaluation.equityCurve || [],
      trades: evaluation.trades || [],
      ...evaluation.summary,
    };
  }

  return {
    id: evaluation.id,
    createdAt: evaluation.evaluation?.ranAt,
    strategy: evaluation.strategy,
    evaluation: evaluation.evaluation,
    metrics: evaluation.metrics,
    scores: evaluation.scores,
    regimeStats: evaluation.regimeStats || [],
    sensitivityTests: evaluation.sensitivityTests || [],
    coachNotes: evaluation.coachNotes || [],
    equityCurve: evaluation.equityCurve || [],
    trades: evaluation.trades || [],
  };
}

function ScoreCard({ label, value, sub, accent = 'text-white' }) {
  return (
    <div className="bg-slate-800/35 rounded p-3 border border-slate-800/60">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${accent}`}>{value}</div>
      {sub ? <div className="text-xs text-slate-500 mt-1">{sub}</div> : null}
    </div>
  );
}

export default function StrategyLab() {
  const { addToast, config } = useApp();
  const [strategies, setStrategies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [normalizingImport, setNormalizingImport] = useState(false);
  const [importingFamily, setImportingFamily] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [selectedStrategyId, setSelectedStrategyId] = useState(null);
  const [evaluations, setEvaluations] = useState([]);
  const [selectedEvaluation, setSelectedEvaluation] = useState(null);
  const [selectedFamily, setSelectedFamily] = useState(null);
  const [familyRecommendation, setFamilyRecommendation] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [analyzerForm, setAnalyzerForm] = useState(DEFAULT_ANALYZER_FORM);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [llmModel, setLlmModel] = useState('');
  const [llmProposal, setLlmProposal] = useState(null);
  const [generatingProposal, setGeneratingProposal] = useState(false);
  const [generatingChildren, setGeneratingChildren] = useState(false);
  const [importNotes, setImportNotes] = useState('');
  const [importVariants, setImportVariants] = useState([]);
  const [selectedImportVariantIndex, setSelectedImportVariantIndex] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [focusActiveBranch, setFocusActiveBranch] = useState(false);

  const selectedStrategy = useMemo(
    () => strategies.find((strategy) => strategy.id === selectedStrategyId) || null,
    [strategies, selectedStrategyId]
  );

  const groupedStrategies = useMemo(() => {
    const groups = [];
    const familyMap = new Map();

    for (const strategy of strategies) {
      const familyKey = strategy.familyId ? `family-${strategy.familyId}` : `strategy-${strategy.id}`;
      if (!familyMap.has(familyKey)) {
        const group = {
          key: familyKey,
          familyId: strategy.familyId || null,
          familyName: strategy.familyName || strategy.name,
          sourceKind: strategy.sourceKind,
          items: [],
        };
        familyMap.set(familyKey, group);
        groups.push(group);
      }
      familyMap.get(familyKey).items.push(strategy);
    }

    return groups.map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => {
        if (a.familyRole === 'parent' && b.familyRole !== 'parent') return -1;
        if (b.familyRole === 'parent' && a.familyRole !== 'parent') return 1;
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      }),
    }));
  }, [strategies]);

  const familyBestMember = useMemo(
    () => selectedFamily?.members?.find((member) => member.id === selectedFamily.bestMemberId) || null,
    [selectedFamily]
  );

  const familyActiveMember = useMemo(
    () => selectedFamily?.members?.find((member) => member.id === selectedFamily.activeStrategyId) || null,
    [selectedFamily]
  );

  const activeBranchIds = useMemo(() => {
    if (!selectedFamily?.members?.length || !selectedFamily.activeStrategyId) return null;

    const memberMap = new Map(selectedFamily.members.map((member) => [member.id, member]));
    const childrenByParent = new Map();

    for (const member of selectedFamily.members) {
      if (!member.parentStrategyId) continue;
      const siblings = childrenByParent.get(member.parentStrategyId) || [];
      siblings.push(member.id);
      childrenByParent.set(member.parentStrategyId, siblings);
    }

    const ids = new Set();
    let cursor = selectedFamily.activeStrategyId;

    while (cursor && memberMap.has(cursor) && !ids.has(cursor)) {
      ids.add(cursor);
      cursor = memberMap.get(cursor)?.parentStrategyId || null;
    }

    const queue = [selectedFamily.activeStrategyId];
    while (queue.length) {
      const currentId = queue.shift();
      const children = childrenByParent.get(currentId) || [];
      for (const childId of children) {
        if (ids.has(childId)) continue;
        ids.add(childId);
        queue.push(childId);
      }
    }

    return ids;
  }, [selectedFamily]);

  const visibleFamilyMembers = useMemo(() => {
    if (!selectedFamily?.members?.length) return [];

    let members = [...selectedFamily.members];

    if (!showArchived) {
      members = members.filter((member) => member.status !== 'archived');
    }

    if (focusActiveBranch && activeBranchIds) {
      members = members.filter((member) => activeBranchIds.has(member.id));
    }

    return members;
  }, [selectedFamily, showArchived, focusActiveBranch, activeBranchIds]);

  const familyGenerations = useMemo(() => {
    if (!visibleFamilyMembers.length) return [];
    const generations = [...new Set(visibleFamilyMembers.map((member) => member.generation || 0))].sort((a, b) => a - b);
    return generations.map((generation) => ({
      generation,
      members: visibleFamilyMembers.filter((member) => (member.generation || 0) === generation),
    }));
  }, [visibleFamilyMembers]);

  const loadStrategies = async () => {
    try {
      const data = await api.getStrategyLabStrategies();
      setStrategies(data);
      if (!selectedStrategyId && data.length) {
        setSelectedStrategyId(data[0].id);
      }
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadRecommendations = async (nextProfile = profile) => {
    setLoadingRecommendations(true);
    try {
      const data = await api.getStrategyLabRecommendations(nextProfile);
      setRecommendations(data.recommendations || []);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoadingRecommendations(false);
    }
  };

  const loadEvaluations = async (strategyId) => {
    if (!strategyId) return;
    try {
      const data = await api.getStrategyLabEvaluations(strategyId, { limit: 8 });
      setEvaluations(data);
      if (data.length) {
        const latest = normalizeEvaluation(data[0]);
        setSelectedEvaluation((current) => (current?.id === latest.id ? current : latest));
      } else {
        setSelectedEvaluation(null);
      }
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const loadFamily = async (strategyId) => {
    if (!strategyId) return;
    try {
      const data = await api.getStrategyLabStrategyFamily(strategyId);
      setSelectedFamily(data);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const loadFamilyRecommendation = async (strategyId, nextProfile = profile) => {
    if (!strategyId) return;
    try {
      const data = await api.getStrategyLabFamilyRecommendation(strategyId, nextProfile);
      setFamilyRecommendation(data);
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  useEffect(() => {
    loadStrategies();
    loadRecommendations(DEFAULT_PROFILE);
  }, []);

  useEffect(() => {
    if (config?.llm_model) {
      setLlmModel(config.llm_model);
    }
  }, [config?.llm_model]);

  useEffect(() => {
    if (!selectedStrategy) return;

    setAnalyzerForm((current) => ({
      ...current,
      symbol: selectedStrategy.market?.allowedPairs?.[0] || current.symbol,
      timeframe: selectedStrategy.market?.preferredTimeframes?.[0] || current.timeframe,
    }));
    loadFamily(selectedStrategy.id);
    loadFamilyRecommendation(selectedStrategy.id, profile);
    loadEvaluations(selectedStrategy.id);
  }, [selectedStrategyId]);

  useEffect(() => {
    if (!selectedStrategyId) return;
    loadFamilyRecommendation(selectedStrategyId, profile);
  }, [profile.riskLevel, profile.timeframePreference, profile.objective]);

  const handleImport = async () => {
    if (!form.name.trim()) {
      addToast('Strategy name is required', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        style: form.style,
        directionality: form.directionality,
        sourceUrl: form.sourceUrl || null,
        sourceAuthor: form.sourceAuthor || null,
        pineScript: form.pineScript || null,
        market: {
          allowedPairs: form.allowedPairs.split(',').map((value) => value.trim()).filter(Boolean),
          preferredTimeframes: form.preferredTimeframes.split(',').map((value) => value.trim()).filter(Boolean),
        },
        rules: {
          entry: form.entry,
          exit: form.exit,
          filters: [],
          risk: { stopLossPct: 0.02, takeProfitPct: 0.05 },
        },
        notes: {
          hypothesis: form.hypothesis,
          assumptions: form.assumptions.split('\n').map((value) => value.trim()).filter(Boolean),
        },
        model: llmModel || config?.llm_model,
        selectedVariantIndex: selectedImportVariantIndex,
      };

      const result = form.importMode === 'tradingview'
        ? await api.importTradingViewStrategy(payload)
        : await api.importStrategyLabStrategy(payload);

      setImportNotes(result.importNotes || '');
      setImportVariants([]);
      setSelectedImportVariantIndex(0);
      addToast(`Strategy imported into Strategy Lab${result.model ? ` with ${result.model}` : ''}`, 'success');
      setForm(EMPTY_FORM);
      await loadStrategies();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const normalizeTradingViewImport = async () => {
    if (!form.sourceUrl && !form.pineScript.trim()) {
      addToast('Provide a TradingView URL or Pine script first', 'warning');
      return;
    }

    setNormalizingImport(true);
    try {
      const result = await api.normalizeTradingViewStrategy({
        name: form.name || undefined,
        sourceUrl: form.sourceUrl || undefined,
        sourceAuthor: form.sourceAuthor || undefined,
        pineScript: form.pineScript || undefined,
        model: llmModel || config?.llm_model,
      });
      const normalized = result.normalized || {};
      setForm((current) => ({
        ...current,
        name: normalized.name || current.name,
        style: normalized.style || current.style,
        directionality: normalized.directionality || current.directionality,
        sourceAuthor: normalized.sourceAuthor || current.sourceAuthor,
        allowedPairs: (normalized.market?.allowedPairs || current.allowedPairs.split(',')).join(','),
        preferredTimeframes: (normalized.market?.preferredTimeframes || current.preferredTimeframes.split(',')).join(','),
        entry: normalized.rules?.entry || current.entry,
        exit: normalized.rules?.exit || current.exit,
        hypothesis: normalized.notes?.hypothesis || current.hypothesis,
        assumptions: (normalized.notes?.assumptions || current.assumptions.split('\n')).join('\n'),
      }));
      setImportVariants(result.variants || []);
      setSelectedImportVariantIndex(0);
      setImportNotes(result.importNotes || (result.metadata?.description ? `Fetched: ${result.metadata.description}` : ''));
      addToast(`TradingView strategy normalized${result.model ? ` with ${result.model}` : ''}`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setNormalizingImport(false);
    }
  };

  const importAndAnalyzeFamily = async () => {
    if (!form.sourceUrl && !form.pineScript.trim()) {
      addToast('Provide a TradingView URL or Pine script first', 'warning');
      return;
    }

    setImportingFamily(true);
    try {
      const result = await api.importTradingViewStrategyFamily({
        name: form.name || undefined,
        sourceUrl: form.sourceUrl || undefined,
        sourceAuthor: form.sourceAuthor || undefined,
        pineScript: form.pineScript || undefined,
        model: llmModel || config?.llm_model,
        startDate: analyzerForm.startDate,
        endDate: analyzerForm.endDate,
        profile,
      });

      setImportNotes(result.importNotes || '');
      setImportVariants([]);
      setSelectedImportVariantIndex(0);
      setForm(EMPTY_FORM);
      await loadStrategies();
      await loadRecommendations(profile);

      if (result.bestVariant?.strategyId) {
        setSelectedStrategyId(result.bestVariant.strategyId);
      }
      addToast(`Imported and analyzed ${result.variants?.length || 0} sibling variants`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setImportingFamily(false);
    }
  };

  const runEvaluation = async () => {
    if (!selectedStrategy) {
      addToast('Select a strategy first', 'warning');
      return;
    }

    setEvaluating(true);
    try {
      const result = await api.evaluateStrategyLabStrategy(selectedStrategy.id, analyzerForm);
      const normalized = normalizeEvaluation(result);
      setSelectedEvaluation(normalized);
      addToast(`Analyzer complete: ${selectedStrategy.name}`, 'success');
      loadEvaluations(selectedStrategy.id);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setEvaluating(false);
    }
  };

  const generateAiProposal = async () => {
    setGeneratingProposal(true);
    try {
      const result = await api.generateStrategyLabLlmProposals({
        ...profile,
        model: llmModel || config?.llm_model,
        strategyId: selectedStrategy?.id,
        evaluationId: selectedEvaluation?.id,
      });
      setLlmProposal(result);
      addToast(`AI proposal generated with ${result.model}`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setGeneratingProposal(false);
    }
  };

  const generateNextGenerationChildren = async () => {
    const baseId = familyRecommendation?.best?.strategyId || selectedStrategyId;
    if (!baseId) {
      addToast('Select a strategy family first', 'warning');
      return;
    }

    setGeneratingChildren(true);
    try {
      const result = await api.generateStrategyLabChildren(baseId, {
        profile,
        model: llmModel || config?.llm_model,
        startDate: analyzerForm.startDate,
        endDate: analyzerForm.endDate,
      });
      await loadStrategies();
      await loadRecommendations(profile);
      await loadFamily(baseId);
      await loadFamilyRecommendation(baseId, profile);
      if (result.bestChild?.strategyId) {
        setSelectedStrategyId(result.bestChild.strategyId);
      }
      addToast(`Generated ${result.children?.length || 0} next-generation variants`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setGeneratingChildren(false);
    }
  };

  const promoteStrategy = async (strategyId) => {
    try {
      const family = await api.promoteStrategyLabStrategy(strategyId);
      setSelectedFamily(family);
      await loadFamilyRecommendation(strategyId, profile);
      await loadStrategies();
      setSelectedStrategyId(strategyId);
      addToast('Strategy promoted as active branch', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const archiveStrategy = async (strategyId) => {
    try {
      const family = await api.archiveStrategyLabStrategy(strategyId);
      setSelectedFamily(family);
      await loadStrategies();
      await loadRecommendations(profile);
      if (family?.activeStrategyId) {
        setSelectedStrategyId(family.activeStrategyId);
        await loadFamilyRecommendation(family.activeStrategyId, profile);
      }
      addToast('Strategy archived', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const evaluation = selectedEvaluation;
  const equityCurve = evaluation?.equityCurve || [];

  return (
    <div className="p-4 space-y-4">
      <div className="bg-[#12151a] rounded-lg border border-slate-800/50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <BrainCircuit size={18} className="text-yellow-400" />
              <h2 className="text-lg font-semibold">Strategy Lab</h2>
            </div>
            <p className="text-sm text-slate-400 max-w-3xl">
              Strategy Lab now recommends strategies by user profile, proposes safer or higher-beta variants, and lets you
              drill into deterministic analysis before paper-forward validation.
            </p>
          </div>
          <div className="px-3 py-2 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-xs font-semibold">
            Recommendations
          </div>
        </div>
      </div>

      <div className="bg-[#12151a] rounded-lg border border-slate-800/50 p-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-sm font-semibold mb-1">Best For Your Profile</div>
            <div className="text-sm text-slate-500">
              Rank strategies by risk tolerance, trading timeframe, and goal. Recommendations prioritize the strongest
              analyzed setups and fall back to heuristics when a strategy has not been evaluated yet.
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3 min-w-[620px]">
            <select value={profile.riskLevel} onChange={(e) => setProfile({ ...profile, riskLevel: e.target.value })} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm">
              <option value="conservative">Conservative Risk</option>
              <option value="balanced">Balanced Risk</option>
              <option value="aggressive">Aggressive Risk</option>
            </select>
            <select value={profile.timeframePreference} onChange={(e) => setProfile({ ...profile, timeframePreference: e.target.value })} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm">
              <option value="scalping">Scalping</option>
              <option value="intraday">Intraday</option>
              <option value="swing">Swing</option>
            </select>
            <select value={profile.objective} onChange={(e) => setProfile({ ...profile, objective: e.target.value })} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm">
              <option value="consistency">Consistency</option>
              <option value="higher_return">Higher Return</option>
              <option value="low_drawdown">Low Drawdown</option>
            </select>
            <button onClick={() => loadRecommendations(profile)} disabled={loadingRecommendations} className="bg-emerald-500 text-black rounded px-4 py-2 text-sm font-semibold hover:bg-emerald-400 disabled:opacity-60">
              {loadingRecommendations ? 'Ranking...' : 'Recommend'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mt-4">
          {recommendations.map((recommendation, index) => (
            <div key={recommendation.strategyId} className="bg-slate-800/25 border border-slate-800/60 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-yellow-400 font-semibold mb-1">#{index + 1} Recommended</div>
                  <div className="font-semibold">{recommendation.name}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {recommendation.style} · {recommendation.directionality} · {recommendation.sourceKind}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-emerald-400">{formatNumber(recommendation.score, 1)}</div>
                  <div className="text-[11px] text-slate-500">{recommendation.basedOnEvaluation ? 'Analyzer-backed' : 'Heuristic'}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-4 text-xs">
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-slate-500">Drawdown</div>
                  <div className="text-red-400">{formatPercent(-recommendation.metrics.maxDrawdownPct, 1)}</div>
                </div>
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-slate-500">Stability</div>
                  <div className="text-white">{formatNumber(recommendation.metrics.stability, 1)}</div>
                </div>
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-slate-500">PF</div>
                  <div className="text-white">{formatNumber(recommendation.metrics.profitFactor, 2)}</div>
                </div>
              </div>

              <div className="mt-4 text-sm text-slate-300">{recommendation.rationale}</div>

              <div className="mt-4 bg-slate-900/45 rounded p-3 border border-slate-800/50">
                <div className="text-xs text-blue-400 font-semibold mb-1">Proposed Variant</div>
                <div className="text-sm font-medium">{recommendation.proposedVariant.title}</div>
                <div className="text-xs text-slate-400 mt-1">{recommendation.proposedVariant.summary}</div>
                <div className="text-xs text-slate-300 mt-3 space-y-1">
                  {recommendation.proposedVariant.changes.map((change, changeIndex) => (
                    <div key={`${recommendation.strategyId}-change-${changeIndex}`}>- {change}</div>
                  ))}
                </div>
                <div className="text-xs text-slate-500 mt-3">{recommendation.proposedVariant.rationale}</div>
              </div>

              <button
                onClick={() => setSelectedStrategyId(recommendation.strategyId)}
                className="mt-4 w-full py-2 bg-yellow-500 text-black rounded text-sm font-semibold hover:bg-yellow-400"
              >
                Open In Analyzer
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 bg-slate-900/35 border border-slate-800/60 rounded-lg p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-semibold">AI Strategy Proposals</div>
              <div className="text-sm text-slate-500 mt-1">
                Use an OpenAI model to turn the deterministic recommendations into a more opinionated set of strategy ideas.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm"
                disabled={!config?.llm_enabled}
              >
                {(config?.llm_available_models || []).map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              <button
                onClick={generateAiProposal}
                disabled={!config?.llm_enabled || !llmModel || generatingProposal}
                className="bg-blue-500 text-white rounded px-4 py-2 text-sm font-semibold hover:bg-blue-400 disabled:opacity-60"
              >
                {generatingProposal ? 'Generating...' : 'Generate AI Ideas'}
              </button>
            </div>
          </div>

          {!config?.llm_enabled ? (
            <div className="mt-3 text-sm text-slate-500">
              Set <code className="bg-slate-800 px-1 rounded">OPENAI_API_KEY</code> on the server to enable AI proposals.
            </div>
          ) : null}

          {llmProposal ? (
            <div className="mt-4 space-y-3">
              <div className="text-sm text-slate-300">
                <span className="text-slate-500">Model:</span> {llmProposal.model}
              </div>
              <div className="text-sm text-slate-300 bg-slate-800/35 rounded p-3 border border-slate-800/50">
                {llmProposal.summary}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {llmProposal.proposals.map((proposal, index) => (
                  <div key={`${proposal.title}-${index}`} className="bg-slate-800/25 rounded p-4 border border-slate-800/50">
                    <div className="text-sm font-semibold">{proposal.title}</div>
                    <div className="text-xs text-slate-500 mt-1">{proposal.fit}</div>
                    <div className="text-sm text-slate-300 mt-3">{proposal.why}</div>
                    <div className="text-xs text-blue-400 mt-3">Based on {proposal.basedOn}</div>
                    <div className="text-xs text-slate-300 mt-3 space-y-1">
                      {(proposal.changes || []).map((change, changeIndex) => (
                        <div key={`${proposal.title}-change-${changeIndex}`}>- {change}</div>
                      ))}
                    </div>
                    <div className="text-xs text-red-300/80 mt-3">{proposal.cautions}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-[320px,1fr] gap-4">
        <div className="space-y-4">
          <div className="bg-[#12151a] rounded-lg border border-slate-800/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800/50 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-400">Library ({strategies.length})</span>
              <button onClick={loadStrategies} className="text-xs text-slate-400 hover:text-white">Refresh</button>
            </div>

            {loading ? (
              <div className="p-8 text-center text-slate-500 text-sm">Loading Strategy Lab...</div>
            ) : (
              <div className="divide-y divide-slate-800/50 max-h-[420px] overflow-auto">
                {groupedStrategies.map((group) => (
                  <div key={group.key} className="p-3">
                    <div className="flex items-center justify-between px-1 pb-2">
                      <div>
                        <div className="text-sm font-semibold">{group.familyName}</div>
                        <div className="text-[11px] text-slate-500">
                          {group.familyId ? `${group.items.length} sibling variants` : 'Standalone strategy'} · {group.sourceKind}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {group.items.map((strategy) => (
                        <button
                          key={strategy.id}
                          onClick={() => setSelectedStrategyId(strategy.id)}
                          className={`w-full text-left p-3 rounded hover:bg-slate-800/20 border ${selectedStrategyId === strategy.id ? 'bg-slate-800/40 border-yellow-500/30' : 'border-slate-800/40 bg-slate-900/20'}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">
                                {strategy.name}
                                {strategy.variantLabel ? <span className="ml-2 text-xs text-blue-300">({strategy.variantLabel})</span> : null}
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                {strategy.style} · {strategy.directionality} · {strategy.familyRole || 'standalone'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300 capitalize">{strategy.status}</div>
                              <div className="text-[11px] text-slate-500 mt-1">{formatDate(strategy.updatedAt)}</div>
                            </div>
                          </div>
                          <div className="mt-3 text-xs text-slate-400">
                            {(strategy.market?.allowedPairs || []).slice(0, 3).join(', ') || 'No pairs'} · {(strategy.market?.preferredTimeframes || []).join(', ') || 'No timeframes'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#12151a] rounded-lg border border-slate-800/50 p-4">
            <div className="flex items-center gap-2 mb-4">
              <Download size={16} className="text-blue-400" />
              <h3 className="text-sm font-semibold">Strategy Import</h3>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    setForm({ ...form, importMode: 'tradingview' });
                    setImportVariants([]);
                    setSelectedImportVariantIndex(0);
                    setImportNotes('');
                  }}
                  className={`py-2 rounded text-sm font-medium border ${form.importMode === 'tradingview' ? 'bg-blue-500/20 border-blue-500/40 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                >
                  TradingView
                </button>
                <button
                  onClick={() => {
                    setForm({ ...form, importMode: 'manual' });
                    setImportVariants([]);
                    setSelectedImportVariantIndex(0);
                    setImportNotes('');
                  }}
                  className={`py-2 rounded text-sm font-medium border ${form.importMode === 'manual' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                >
                  Manual
                </button>
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">Strategy Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Style</label>
                  <select value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm">
                    {['trend', 'mean_reversion', 'breakout', 'scalping', 'market_structure', 'swing'].map((style) => (
                      <option key={style} value={style}>{style}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Directionality</label>
                  <select value={form.directionality} onChange={(e) => setForm({ ...form, directionality: e.target.value })} className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm">
                    {['long_only', 'short_only', 'long_short'].map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </div>
              </div>

              <input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://www.tradingview.com/..." className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
              <input value={form.sourceAuthor} onChange={(e) => setForm({ ...form, sourceAuthor: e.target.value })} placeholder="Author" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
              <textarea rows={6} value={form.pineScript} onChange={(e) => setForm({ ...form, pineScript: e.target.value })} placeholder="Paste Pine script or strategy notes for normalization" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm resize-none font-mono" />
              <input value={form.allowedPairs} onChange={(e) => setForm({ ...form, allowedPairs: e.target.value })} placeholder="BTCUSDT,ETHUSDT" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
              <input value={form.preferredTimeframes} onChange={(e) => setForm({ ...form, preferredTimeframes: e.target.value })} placeholder="1h,4h" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
              <textarea rows={2} value={form.entry} onChange={(e) => setForm({ ...form, entry: e.target.value })} placeholder="Entry rule summary" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm resize-none" />
              <textarea rows={2} value={form.exit} onChange={(e) => setForm({ ...form, exit: e.target.value })} placeholder="Exit rule summary" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm resize-none" />
              <textarea rows={2} value={form.hypothesis} onChange={(e) => setForm({ ...form, hypothesis: e.target.value })} placeholder="Hypothesis" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm resize-none" />
              <textarea rows={3} value={form.assumptions} onChange={(e) => setForm({ ...form, assumptions: e.target.value })} placeholder="Assumptions, one per line" className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm resize-none" />

              {form.importMode === 'tradingview' ? (
                <button onClick={normalizeTradingViewImport} disabled={normalizingImport} className="w-full py-2.5 bg-blue-500 text-white rounded font-semibold text-sm hover:bg-blue-400 disabled:opacity-60 flex items-center justify-center gap-2">
                  <Sparkles size={14} />
                  {normalizingImport ? 'Normalizing...' : 'Normalize TradingView Input'}
                </button>
              ) : null}

              {importNotes ? (
                <div className="text-xs text-slate-400 bg-slate-800/35 border border-slate-800/50 rounded p-3">
                  {importNotes}
                </div>
              ) : null}

              {importVariants.length ? (
                <div className="space-y-2">
                  <div className="text-xs text-slate-500">Choose a normalized variant</div>
                  <div className="space-y-2">
                    {importVariants.map((variant, index) => (
                      <button
                        key={`${variant.label}-${index}`}
                        onClick={() => {
                          setSelectedImportVariantIndex(index);
                          setForm((current) => ({
                            ...current,
                            name: variant.strategy.name || current.name,
                            style: variant.strategy.style || current.style,
                            directionality: variant.strategy.directionality || current.directionality,
                            sourceAuthor: variant.strategy.sourceAuthor || current.sourceAuthor,
                            allowedPairs: (variant.strategy.market?.allowedPairs || []).join(',') || current.allowedPairs,
                            preferredTimeframes: (variant.strategy.market?.preferredTimeframes || []).join(',') || current.preferredTimeframes,
                            entry: variant.strategy.rules?.entry || current.entry,
                            exit: variant.strategy.rules?.exit || current.exit,
                            hypothesis: variant.strategy.notes?.hypothesis || current.hypothesis,
                            assumptions: (variant.strategy.notes?.assumptions || []).join('\n') || current.assumptions,
                          }));
                        }}
                        className={`w-full text-left rounded border p-3 ${selectedImportVariantIndex === index ? 'border-blue-500/50 bg-blue-500/10' : 'border-slate-800/50 bg-slate-800/20'}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">{variant.label}</div>
                            <div className="text-xs text-slate-500 mt-1">{variant.strategy.style} · {variant.strategy.directionality}</div>
                          </div>
                          <div className="text-xs text-slate-400">{(variant.strategy.market?.preferredTimeframes || []).join(', ')}</div>
                        </div>
                        {variant.summary ? <div className="text-xs text-slate-400 mt-2">{variant.summary}</div> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <button onClick={handleImport} disabled={submitting} className="w-full py-2.5 bg-yellow-500 text-black rounded font-semibold text-sm hover:bg-yellow-400 disabled:opacity-60 flex items-center justify-center gap-2">
                <Sparkles size={14} />
                {submitting ? 'Importing...' : `Import ${form.importMode === 'tradingview' ? 'TradingView Strategy' : 'Into Strategy Lab'}`}
              </button>

              {form.importMode === 'tradingview' ? (
                <button onClick={importAndAnalyzeFamily} disabled={importingFamily} className="w-full py-2.5 bg-emerald-500 text-black rounded font-semibold text-sm hover:bg-emerald-400 disabled:opacity-60 flex items-center justify-center gap-2">
                  <FlaskConical size={14} />
                  {importingFamily ? 'Importing + Analyzing...' : 'Import + Analyze All Variants'}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-4 min-w-0">
          <div className="bg-[#12151a] rounded-lg border border-slate-800/50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">{selectedStrategy?.name || 'Select a strategy'}</div>
                <div className="text-sm text-slate-500 mt-1">
                  {selectedStrategy ? `${selectedStrategy.style} · ${selectedStrategy.directionality} · ${selectedStrategy.sourceKind}` : 'Strategy analyzer is ready once a library item is selected.'}
                </div>
                {selectedStrategy?.notes?.hypothesis ? (
                  <div className="text-sm text-slate-400 mt-3">
                    <span className="text-slate-500">Hypothesis: </span>{selectedStrategy.notes.hypothesis}
                  </div>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3 min-w-[320px]">
                <select value={analyzerForm.symbol} onChange={(e) => setAnalyzerForm({ ...analyzerForm, symbol: e.target.value })} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm">
                  {(selectedStrategy?.market?.allowedPairs || ['BTCUSDT']).map((pair) => <option key={pair} value={pair}>{pair}</option>)}
                </select>
                <select value={analyzerForm.timeframe} onChange={(e) => setAnalyzerForm({ ...analyzerForm, timeframe: e.target.value })} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm">
                  {(selectedStrategy?.market?.preferredTimeframes || ['1h']).map((timeframe) => <option key={timeframe} value={timeframe}>{timeframe}</option>)}
                </select>
                <input type="date" value={analyzerForm.startDate} onChange={(e) => setAnalyzerForm({ ...analyzerForm, startDate: e.target.value })} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
                <input type="date" value={analyzerForm.endDate} onChange={(e) => setAnalyzerForm({ ...analyzerForm, endDate: e.target.value })} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm" />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-4">
              <div className="text-xs text-slate-500">
                Analyzer runs a deterministic backtest, parameter perturbation, regime segmentation, and coach rule pass.
              </div>
              <button onClick={runEvaluation} disabled={!selectedStrategy || evaluating} className="px-4 py-2.5 bg-blue-500 text-white rounded font-semibold text-sm hover:bg-blue-400 disabled:opacity-60 flex items-center gap-2">
                <FlaskConical size={15} />
                {evaluating ? 'Running Analyzer...' : 'Run Analyzer'}
              </button>
            </div>
          </div>

          {selectedFamily ? (
            <div className="bg-[#12151a] rounded-lg border border-slate-800/50 p-4">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="text-sm font-semibold">Family Detail</div>
                  <div className="text-sm text-slate-500 mt-1">
                    {selectedFamily.familyName} · {visibleFamilyMembers.length} of {selectedFamily.members.length} variants shown
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {familyBestMember ? (
                    <div className="px-3 py-2 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-semibold">
                      Best Sibling: {familyBestMember.variantLabel || familyBestMember.name}
                    </div>
                  ) : null}
                  <button
                    onClick={generateNextGenerationChildren}
                    disabled={generatingChildren}
                    className="px-4 py-2 rounded bg-blue-500 text-white text-sm font-semibold hover:bg-blue-400 disabled:opacity-60"
                  >
                    {generatingChildren ? 'Generating Children...' : 'Generate Next-Gen Variants'}
                  </button>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setShowArchived((current) => !current)}
                  className={`px-3 py-2 rounded border text-xs font-semibold ${showArchived ? 'border-slate-600 bg-slate-800 text-white' : 'border-slate-800/60 bg-slate-900/30 text-slate-400'}`}
                >
                  {showArchived ? 'Hide Archived' : 'Show Archived'}
                </button>
                <button
                  onClick={() => setFocusActiveBranch((current) => !current)}
                  disabled={!selectedFamily.activeStrategyId}
                  className={`px-3 py-2 rounded border text-xs font-semibold ${focusActiveBranch ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300' : 'border-slate-800/60 bg-slate-900/30 text-slate-400'} disabled:opacity-50`}
                >
                  {focusActiveBranch ? 'Show Full Family' : 'Active Branch Only'}
                </button>
                {familyActiveMember ? (
                  <div className="text-xs text-slate-500">
                    Active branch: <span className="text-white">{familyActiveMember.variantLabel || familyActiveMember.name}</span>
                  </div>
                ) : null}
              </div>

              {familyRecommendation ? (
                <div className="mb-4 grid grid-cols-[1.4fr,0.6fr] gap-4">
                  <div className="bg-slate-900/35 rounded p-4 border border-slate-800/50">
                    <div className="text-xs text-emerald-400 font-semibold mb-2">Family Recommendation</div>
                    <div className="text-sm text-slate-300">{familyRecommendation.summary}</div>
                  </div>
                  <div className="bg-slate-900/35 rounded p-4 border border-slate-800/50">
                    <div className="text-xs text-slate-500 mb-2">Best By Risk</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">Conservative</span>
                        <span className="text-white">{familyRecommendation.byRisk.conservative?.name || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">Balanced</span>
                        <span className="text-white">{familyRecommendation.byRisk.balanced?.name || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-400">Aggressive</span>
                        <span className="text-white">{familyRecommendation.byRisk.aggressive?.name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {familyActiveMember && familyBestMember && familyActiveMember.id !== familyBestMember.id ? (
                <div className="mb-4 rounded border border-yellow-500/20 bg-yellow-500/5 p-4">
                  <div className="text-xs font-semibold text-yellow-300 mb-2">Active vs Best</div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-slate-500 mb-1">Active branch</div>
                      <div className="text-white font-medium">{familyActiveMember.variantLabel || familyActiveMember.name}</div>
                      <div className="text-xs text-slate-500 mt-1">{familyActiveMember.style} · {familyActiveMember.directionality}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 mb-1">Current best fit</div>
                      <div className="text-white font-medium">{familyBestMember.variantLabel || familyBestMember.name}</div>
                      <div className="text-xs text-slate-500 mt-1">{familyBestMember.style} · {familyBestMember.directionality}</div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-400 mt-3">
                    The active branch is your chosen working line. The best sibling is the strongest current fit for the selected risk, timeframe, and objective profile.
                  </div>
                </div>
              ) : null}

              {!visibleFamilyMembers.length ? (
                <div className="rounded border border-slate-800/50 bg-slate-900/20 p-6 text-sm text-slate-500">
                  No variants match the current family filters. Enable archived variants or switch back to the full family view.
                </div>
              ) : null}

              <div className="space-y-4">
                {familyGenerations.map((bucket) => (
                  <div key={`generation-${bucket.generation}`}>
                    <div className="text-xs font-semibold text-blue-300 mb-2">Generation {bucket.generation}</div>
                    <div className="space-y-2">
                      {bucket.members.map((member) => {
                        const summary = member.latestEvaluation?.summary;
                        return (
                          <button
                            key={member.id}
                            onClick={() => setSelectedStrategyId(member.id)}
                            className={`w-full text-left grid grid-cols-[1.5fr,0.7fr,0.7fr,0.7fr,0.8fr,0.9fr] gap-3 rounded p-3 border ${selectedStrategyId === member.id ? 'border-yellow-500/30 bg-yellow-500/5' : 'border-slate-800/50 bg-slate-800/20 hover:bg-slate-800/35'}`}
                          >
                            <div>
                              <div className="font-medium">
                                {member.variantLabel || member.name}
                                {member.id === selectedFamily.bestMemberId ? <span className="ml-2 text-xs text-emerald-400">Best</span> : null}
                                {member.id === selectedFamily.activeStrategyId ? <span className="ml-2 text-xs text-yellow-300">Active</span> : null}
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                {member.style} · {member.directionality} · {member.familyRole}
                                {member.parentStrategyId ? ` · child of #${member.parentStrategyId}` : ''}
                              </div>
                            </div>
                            <div className="text-sm text-slate-300">
                              {summary ? formatNumber(summary.scores.total, 1) : '—'}
                              <div className="text-[11px] text-slate-500">Score</div>
                            </div>
                            <div className={`text-sm ${summary ? pnlColor(summary.metrics.netProfit) : 'text-slate-500'}`}>
                              {summary ? formatUSD(summary.metrics.netProfit) : '—'}
                              <div className="text-[11px] text-slate-500">Net</div>
                            </div>
                            <div className="text-sm text-slate-300">
                              {summary ? formatPercent(summary.metrics.winRate, 1) : '—'}
                              <div className="text-[11px] text-slate-500">Win Rate</div>
                            </div>
                            <div className="text-sm text-slate-300">
                              {summary ? formatPercent(-summary.metrics.maxDrawdownPct, 1) : '—'}
                              <div className="text-[11px] text-slate-500">Drawdown</div>
                            </div>
                            <div className="flex items-center gap-2 justify-end">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  promoteStrategy(member.id);
                                }}
                                className="px-2 py-1 text-xs rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/20 hover:bg-yellow-500/25"
                              >
                                Promote
                              </button>
                              {member.status !== 'archived' ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    archiveStrategy(member.id);
                                  }}
                                  className="px-2 py-1 text-xs rounded bg-red-500/10 text-red-300 border border-red-500/20 hover:bg-red-500/20"
                                >
                                  Archive
                                </button>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {evaluation ? (
            <>
              <div className="grid grid-cols-4 gap-3">
                <ScoreCard label="Total Score" value={formatNumber(evaluation.scores.total, 1)} sub={`${evaluation.evaluation.symbol} · ${evaluation.evaluation.timeframe}`} accent="text-yellow-400" />
                <ScoreCard label="Stability" value={formatNumber(evaluation.scores.stability, 1)} accent={evaluation.scores.stability >= 60 ? 'text-emerald-400' : 'text-red-400'} />
                <ScoreCard label="Portability" value={formatNumber(evaluation.scores.portability, 1)} accent={evaluation.scores.portability >= 60 ? 'text-emerald-400' : 'text-red-400'} />
                <ScoreCard label="Execution Realism" value={formatNumber(evaluation.scores.executionRealism, 1)} accent={evaluation.scores.executionRealism >= 60 ? 'text-emerald-400' : 'text-red-400'} />
                <ScoreCard label="Net Profit" value={formatUSD(evaluation.metrics.netProfit)} sub={formatPercent(evaluation.metrics.netProfitPct)} accent={pnlColor(evaluation.metrics.netProfit)} />
                <ScoreCard label="Profit Factor" value={formatNumber(evaluation.metrics.profitFactor, 2)} />
                <ScoreCard label="Win Rate" value={formatPercent(evaluation.metrics.winRate, 1)} />
                <ScoreCard label="Max Drawdown" value={formatUSD(evaluation.metrics.maxDrawdown)} sub={formatPercent(-evaluation.metrics.maxDrawdownPct, 2)} accent="text-red-400" />
              </div>

              <div className="grid grid-cols-[1.4fr,0.6fr] gap-4">
                <div className="bg-[#12151a] rounded-lg border border-slate-800/50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-medium text-slate-400">Equity Curve</div>
                    <div className="text-xs text-slate-500">
                      Ran {formatDate(evaluation.evaluation.ranAt || evaluation.createdAt)}
                    </div>
                  </div>
                  {equityCurve.length ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={equityCurve.map((point) => ({ date: formatDateShort(point.time), equity: point.equity }))}>
                        <defs>
                          <linearGradient id="strategyLabEquity" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#eab308" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 12 }} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(value) => `$${Math.round(value / 1000)}k`} />
                        <Tooltip formatter={(value) => formatUSD(value)} />
                        <Area type="monotone" dataKey="equity" stroke="#eab308" fill="url(#strategyLabEquity)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-[280px] flex items-center justify-center text-sm text-slate-500">Run an analyzer job to render the equity curve.</div>
                  )}
                </div>

                <div className="bg-[#12151a] rounded-lg border border-slate-800/50 p-4">
                  <div className="text-sm font-medium text-slate-400 mb-3">Coach</div>
                  <div className="space-y-2">
                    {evaluation.coachNotes.map((note, index) => (
                      <div key={`${index}-${note}`} className="text-sm text-slate-300 bg-slate-800/35 rounded p-3 border border-slate-800/50">
                        {note}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#12151a] rounded-lg border border-slate-800/50 p-4">
                  <div className="text-sm font-medium text-slate-400 mb-3">Regime Breakdown</div>
                  <div className="space-y-2">
                    {evaluation.regimeStats.map((regime) => (
                      <div key={regime.regime} className="grid grid-cols-[1.1fr,0.7fr,0.8fr,0.8fr] gap-3 text-sm bg-slate-800/30 rounded p-3">
                        <div>
                          <div className="font-medium capitalize">{regime.regime.replace('_', ' ')}</div>
                          <div className="text-xs text-slate-500">{regime.tradeCount} trades</div>
                        </div>
                        <div className="text-slate-300">{formatPercent(regime.winRate, 1)}</div>
                        <div className={pnlColor(regime.netProfit)}>{formatUSD(regime.netProfit)}</div>
                        <div className="text-slate-300">PF {formatNumber(regime.profitFactor, 2)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-[#12151a] rounded-lg border border-slate-800/50 p-4">
                  <div className="text-sm font-medium text-slate-400 mb-3">Sensitivity</div>
                  <div className="space-y-2">
                    {evaluation.sensitivityTests.map((test, index) => (
                      <div key={`${test.paramName}-${test.paramValue}-${index}`} className="grid grid-cols-[1.2fr,0.8fr,0.9fr,0.8fr] gap-3 text-sm bg-slate-800/30 rounded p-3">
                        <div>
                          <div className="font-medium">{test.paramName}</div>
                          <div className="text-xs text-slate-500">value {test.paramValue}</div>
                        </div>
                        <div className={pnlColor(test.netProfit)}>{formatUSD(test.netProfit)}</div>
                        <div className="text-slate-300">PF {formatNumber(test.profitFactor, 2)}</div>
                        <div className="text-slate-300">Sharpe {formatNumber(test.sharpeRatio, 2)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-[#12151a] rounded-lg border border-slate-800/50 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800/50 text-sm font-medium text-slate-400">
                  Evaluation History ({evaluations.length})
                </div>
                <div className="divide-y divide-slate-800/50">
                  {evaluations.map((item) => {
                    const normalized = normalizeEvaluation(item);
                    return (
                      <button key={item.id} onClick={() => setSelectedEvaluation(normalized)} className={`w-full px-4 py-3 text-left hover:bg-slate-800/25 ${selectedEvaluation?.id === item.id ? 'bg-slate-800/40' : ''}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-medium">{normalized.evaluation.symbol} · {normalized.evaluation.timeframe}</div>
                            <div className="text-xs text-slate-500">{normalized.evaluation.startDate} to {normalized.evaluation.endDate}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-yellow-400 font-semibold">{formatNumber(normalized.scores.total, 1)}</div>
                            <div className="text-xs text-slate-500">{formatDate(item.createdAt)}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-[#12151a] rounded-lg border border-slate-800/50 p-10 text-center text-slate-500">
              Select a strategy and run the analyzer to generate metrics, regimes, sensitivity tests, and coach notes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
