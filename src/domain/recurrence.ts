// ============================================================
// 缺陷复发率统计（Recurrence Rate）
//
// 同一修复位置下一轮仍检出裂缝，有三种可能：
//   ① 原缺陷未修复（residual_unrepaired）
//   ② 修复后在原位复发（confirmed_recurrence / suspected_recurrence）
//   ③ 施工接缝/修复区附近的新缺陷（new_defect）
//
// 本模块把不同检测期内被拆分/合并/重编的构件，先经「资产谱系」映射到
// 统一的局部里程（米，沿结构纵向），再用修复账（施工范围/材料/完成时点/
// 验收证据）把前后两期的区间位置、形态与修复范围组成候选，最后分别统计
// 确认复发、疑似复发与新缺陷，并估计已验收修复后 12 个月内的复发比例。
//
// 两种续接策略：
//   deterministic  构件主键 + 线性里程容差：易复核，但改造后主键重编会丢匹配。
//   probabilistic  形态 + 空间 + 修复上下文：覆盖更高，但必须保留全部候选并
//                  传播匹配不确定性（uncertainty）。
// ============================================================

import type {
  AssetMapRow,
  AssetNode,
  FindingClassification,
  FindingMatchCandidate,
  FindingSegment,
  InspectionFinding,
  LineageCheck,
  MatchStrategy,
  RecurrenceAnalysis,
  RecurrenceClass,
  RecurrenceDataset,
  RecurrenceStat,
  RepairRecord,
} from '../types';

// ---------------- 常量与默认参数 ----------------

/** 12 个月观察窗口（月） */
export const DEFAULT_WINDOW_MONTHS = 12;
/** 概率匹配的候选生成里程容差（米）：只把间距在此范围内的缺陷/修复组成候选 */
export const DEFAULT_CANDIDATE_TOL_M = 6;
/** 确定性续接的线性里程容差（米） */
export const DEFAULT_KEY_TOL_M = 2;
/** 横向偏移容差（米） */
export const DEFAULT_TRANSVERSE_TOL_M = 1.2;
/** 平均每月天数（用于把时间差换算成“月”） */
const DAYS_PER_MONTH = 30.4375;
const EPS = 0.01;

export interface RecurrenceOptions {
  strategy: MatchStrategy;
  windowMonths?: number;
  candidateTolM?: number;
  keyTolM?: number;
  transverseTolM?: number;
}

export interface ResolvedOptions {
  strategy: MatchStrategy;
  windowMonths: number;
  candidateTolM: number;
  keyTolM: number;
  transverseTolM: number;
}

function resolveOptions(o: RecurrenceOptions): ResolvedOptions {
  return {
    strategy: o.strategy,
    windowMonths: o.windowMonths ?? DEFAULT_WINDOW_MONTHS,
    candidateTolM: o.candidateTolM ?? DEFAULT_CANDIDATE_TOL_M,
    keyTolM: o.keyTolM ?? DEFAULT_KEY_TOL_M,
    transverseTolM: o.transverseTolM ?? DEFAULT_TRANSVERSE_TOL_M,
  };
}

export const MORPHOLOGY_LABELS: Record<InspectionFinding['morphology'], string> = {
  diagonal: '斜向裂缝',
  transverse: '横向裂缝',
  longitudinal: '纵向裂缝',
  map_crack: '龟裂/网状裂缝',
  joint: '接缝裂缝',
};

export const CLASS_LABELS: Record<RecurrenceClass, string> = {
  confirmed_recurrence: '确认复发',
  suspected_recurrence: '疑似复发',
  new_defect: '新缺陷',
  residual_unrepaired: '未闭环遗留（非复发）',
  unmatched: '无可续接修复',
};

export const CLASS_TONE: Record<RecurrenceClass, 'danger' | 'warn' | 'brand' | 'purple' | 'slate'> = {
  confirmed_recurrence: 'danger',
  suspected_recurrence: 'warn',
  new_defect: 'brand',
  residual_unrepaired: 'purple',
  unmatched: 'slate',
};

/** 形态相容矩阵：同一/相近受力机制视为相容（用于空间+形态候选） */
function morphologyCompatible(a: InspectionFinding['morphology'], b: InspectionFinding['morphology']): boolean {
  if (a === b) return true;
  const groups: InspectionFinding['morphology'][][] = [
    ['diagonal', 'transverse', 'joint'], // 弯剪/受剪/接缝类
    ['longitudinal', 'map_crack'], // 纵筋锈胀/网状类
  ];
  return groups.some((g) => g.includes(a) && g.includes(b));
}

// ---------------- 基础几何 / 时间工具 ----------------

function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (to - from) / (1000 * 60 * 60 * 24 * DAYS_PER_MONTH);
}

function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function gap(a1: number, a2: number, b1: number, b2: number): number {
  if (a2 < b1) return b1 - a2;
  if (b2 < a1) return a1 - b2;
  return 0;
}

function orientationDiff(aDeg: number, bDeg: number): number {
  const raw = Math.abs(aDeg - bDeg) % 180;
  return Math.min(raw, 180 - raw);
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function m(x: number): string {
  return `${x.toFixed(1)} m`;
}

function intervalText(s: number, e: number): string {
  return `[${s.toFixed(1)}, ${e.toFixed(1)}] m`;
}

// ---------------- 资产谱系 → 统一局部里程 ----------------

export interface ResolvedInterval {
  startM: number;
  endM: number;
  segments: { assetId: string; lineageKey: string; startM: number; endM: number }[];
}

/**
 * 构件主键索引：按 `periodId::assetId` 复合键。
 * 保留类构件（retained）在两期沿用同一 assetId，但几何一致；
 * 拆分/重编后子构件使用新主键，故必须按检测期区分。
 */
function assetIndex(dataset: RecurrenceDataset): Map<string, AssetNode> {
  return new Map(dataset.assets.map((a) => [`${a.periodId}::${a.assetId}`, a]));
}

/** 取某 assetId 最早出现期次的构件节点（用于谱系父节点查找） */
function assetEarliest(dataset: RecurrenceDataset, assetId: string): AssetNode | undefined {
  const periodOrder = new Map(dataset.periods.map((p, i) => [p.periodId, i]));
  return [...dataset.assets]
    .filter((a) => a.assetId === assetId)
    .sort((a, b) => (periodOrder.get(a.periodId) ?? 0) - (periodOrder.get(b.periodId) ?? 0))[0];
}

/** 把一条检出的全部区段映射到统一局部里程；无法解析的区段被跳过 */
export function mapFindingToUnified(
  dataset: RecurrenceDataset,
  finding: InspectionFinding,
  index = assetIndex(dataset),
): ResolvedInterval | null {
  const segments: ResolvedInterval['segments'] = [];
  for (const seg of finding.segments) {
    const asset = index.get(`${finding.periodId}::${seg.assetId}`);
    if (!asset) continue;
    const lo = Math.min(seg.fromOffsetM, seg.toOffsetM);
    const hi = Math.max(seg.fromOffsetM, seg.toOffsetM);
    segments.push({
      assetId: asset.assetId,
      lineageKey: asset.lineageKey,
      startM: asset.unifiedStartM + lo,
      endM: asset.unifiedStartM + hi,
    });
  }
  if (segments.length === 0) return null;
  return {
    startM: Math.min(...segments.map((s) => s.startM)),
    endM: Math.max(...segments.map((s) => s.endM)),
    segments,
  };
}

/** 资产谱系表：按检测期、再按统一里程排序，便于人工复核拆分/合并映射 */
export function buildAssetMap(dataset: RecurrenceDataset): AssetMapRow[] {
  const periodOrder = new Map(dataset.periods.map((p, i) => [p.periodId, i]));
  return [...dataset.assets]
    .sort((a, b) => {
      const pa = periodOrder.get(a.periodId) ?? 0;
      const pb = periodOrder.get(b.periodId) ?? 0;
      if (pa !== pb) return pa - pb;
      if (a.unifiedStartM !== b.unifiedStartM) return a.unifiedStartM - b.unifiedStartM;
      return a.assetId.localeCompare(b.assetId);
    })
    .map((a) => ({
      assetId: a.assetId,
      periodId: a.periodId,
      label: a.label,
      lineageKey: a.lineageKey,
      unifiedStartM: a.unifiedStartM,
      unifiedEndM: a.unifiedEndM,
      derivation: a.derivation,
      derivedFrom: a.derivedFrom,
    }));
}

/**
 * 谱系位置映射核验：
 *  1) 拆分：子构件统一里程并集 == 父构件范围；
 *  2) 合并：父构件并集 == 合并后构件范围；
 *  3) 每个检测期的构件统一里程覆盖连续、无缝无叠；
 *  4) 同一裂缝跨新边界后仍映射到连续里程（区段拼接无缺口）。
 */
export function verifyLineage(dataset: RecurrenceDataset): LineageCheck[] {
  const index = assetIndex(dataset);
  const checks: LineageCheck[] = [];

  // 1) 拆分核验
  const splitParents = new Set<string>();
  for (const a of dataset.assets) {
    if (a.derivation === 'split') for (const p of a.derivedFrom) splitParents.add(p);
  }
  for (const parentId of splitParents) {
    const parent = assetEarliest(dataset, parentId);
    if (!parent) continue;
    const children = dataset.assets.filter((a) => a.derivation === 'split' && a.derivedFrom.includes(parentId));
    const lo = Math.min(...children.map((c) => c.unifiedStartM));
    const hi = Math.max(...children.map((c) => c.unifiedEndM));
    const sum = children.reduce((s, c) => s + (c.unifiedEndM - c.unifiedStartM), 0);
    const span = hi - lo;
    const contiguous = Math.abs(sum - span) <= EPS;
    const covers = Math.abs(lo - parent.unifiedStartM) <= EPS && Math.abs(hi - parent.unifiedEndM) <= EPS;
    checks.push({
      label: `拆分：${parent.label} → ${children.map((c) => c.assetId).join(' + ')}`,
      ok: contiguous && covers,
      detail: `父 ${intervalText(parent.unifiedStartM, parent.unifiedEndM)}；子并集 ${intervalText(lo, hi)}，${
        contiguous ? '子区间首尾相接' : '子区间存在缺口或重叠'
      }，${covers ? '完整覆盖父范围' : '未完整覆盖父范围'}。`,
    });
  }

  // 2) 合并核验
  for (const node of dataset.assets) {
    if (node.derivation !== 'merge') continue;
    const parents = node.derivedFrom
      .map((id) => assetEarliest(dataset, id))
      .filter((x): x is AssetNode => !!x);
    if (parents.length === 0) continue;
    const lo = Math.min(...parents.map((p) => p.unifiedStartM));
    const hi = Math.max(...parents.map((p) => p.unifiedEndM));
    const sum = parents.reduce((s, p) => s + (p.unifiedEndM - p.unifiedStartM), 0);
    const span = hi - lo;
    const equal = Math.abs(lo - node.unifiedStartM) <= EPS && Math.abs(hi - node.unifiedEndM) <= EPS && Math.abs(sum - span) <= EPS;
    checks.push({
      label: `合并：${parents.map((p) => p.assetId).join(' + ')} → ${node.label}`,
      ok: equal,
      detail: `父并集 ${intervalText(lo, hi)}；合并构件 ${intervalText(node.unifiedStartM, node.unifiedEndM)}，${
        equal ? '范围一致（连续可比）' : '范围不一致'
      }。`,
    });
  }

  // 3) 每个检测期覆盖连续性
  for (const period of dataset.periods) {
    const list = dataset.assets
      .filter((a) => a.periodId === period.periodId)
      .sort((a, b) => a.unifiedStartM - b.unifiedStartM);
    if (list.length === 0) continue;
    let ok = true;
    let detail = '';
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (Math.abs(cur.unifiedStartM - prev.unifiedEndM) > EPS) {
        ok = false;
        detail = `在 ${m(prev.unifiedEndM)} 处出现${cur.unifiedStartM > prev.unifiedEndM ? '缺口' : '重叠'}`;
        break;
      }
    }
    const lo = list[0].unifiedStartM;
    const hi = list[list.length - 1].unifiedEndM;
    checks.push({
      label: `覆盖连续性：${period.label}`,
      ok,
      detail: ok
        ? `${list.length} 个构件连续覆盖 ${intervalText(lo, hi)}，无缺口/重叠，跨期同一里程可直接比较。`
        : `${intervalText(lo, hi)} ${detail}。`,
    });
  }

  // 4) 跨新边界裂缝的连续映射
  const splitSeams: { seam: number; label: string }[] = [];
  for (const parentId of splitParents) {
    const parent = assetEarliest(dataset, parentId);
    if (!parent) continue;
    const children = dataset.assets
      .filter((a) => a.derivation === 'split' && a.derivedFrom.includes(parentId))
      .sort((a, b) => a.unifiedStartM - b.unifiedStartM);
    for (let i = 1; i < children.length; i++) {
      splitSeams.push({ seam: children[i].unifiedStartM, label: `${parent.label} 拆分为 ${children[i - 1].assetId}/${children[i].assetId}` });
    }
  }
  const findingsById = new Map(dataset.findings.map((f) => [f.findingId, f]));
  for (const seam of splitSeams) {
    let found = false;
    for (const repair of dataset.repairs) {
      const orig = findingsById.get(repair.findingId);
      if (!orig) continue;
      const oi = mapFindingToUnified(dataset, orig, index);
      if (!oi || !(oi.startM <= seam.seam && seam.seam <= oi.endM)) continue;
      // 找到该修复对应、跨缝的后期检出
      for (const post of dataset.findings) {
        if (post.periodId === orig.periodId) continue;
        if (new Date(post.measuredAt) <= new Date(repair.acceptedAt ?? repair.completedAt)) continue;
        const pi = mapFindingToUnified(dataset, post, index);
        if (!pi || !(pi.startM <= seam.seam && seam.seam <= pi.endM)) continue;
        const order = [...pi.segments].sort((a, b) => a.startM - b.startM);
        const sum = order.reduce((s, seg) => s + (seg.endM - seg.startM), 0);
        const contiguous = Math.abs(sum - (pi.endM - pi.startM)) <= EPS;
        checks.push({
          label: `跨缝映射：${orig.findingId} ↔ ${post.findingId} @ ${m(seam.seam)}`,
          ok: contiguous && pi.segments.length >= 2,
          detail: `${seam.label}；裂缝在 ${m(seam.seam)} 处被新边界切开后由 ${pi.segments.length} 个区段拼接为 ${intervalText(
            pi.startM,
            pi.endM,
          )}，${contiguous ? '拼接后连续、同一里程' : '拼接后不连续'}。`,
        });
        found = true;
        break;
      }
      if (found) break;
    }
    if (!found) {
      checks.push({
        label: `跨缝映射：接缝 ${m(seam.seam)}`,
        ok: true,
        detail: '该接缝附近无跨缝裂缝，无需映射拼接。',
      });
    }
  }

  return checks;
}

// ---------------- 跨期匹配：候选生成与分类 ----------------

interface PairEvaluation {
  candidate: FindingMatchCandidate;
  cls: RecurrenceClass;
  reason: string;
}

function buildCandidate(
  original: InspectionFinding,
  post: InspectionFinding,
  repair: RepairRecord,
  oi: ResolvedInterval,
  pi: ResolvedInterval,
  opts: ResolvedOptions,
): FindingMatchCandidate {
  const postLen = Math.max(EPS, pi.endM - pi.startM);
  const scopeCov = overlap(pi.startM, pi.endM, repair.scope.unifiedStartM, repair.scope.unifiedEndM) / postLen;
  const origCov = overlap(pi.startM, pi.endM, oi.startM, oi.endM) / postLen;
  const cGap = gap(pi.startM, pi.endM, oi.startM, oi.endM);
  const cOverlap = overlap(pi.startM, pi.endM, oi.startM, oi.endM);
  const transverseGapM = Math.abs(post.transverseOffsetM - original.transverseOffsetM);
  const orientationDiffDeg = orientationDiff(post.orientationDeg, original.orientationDeg);
  const morphMatch = morphologyCompatible(post.morphology, original.morphology);

  const origAssets = new Set(original.segments.map((s) => s.assetId));
  const deterministicKeyMatch = post.segments.some((s) => origAssets.has(s.assetId));

  const appearedAfterAcceptance =
    !!repair.acceptedAt && new Date(post.measuredAt).getTime() > new Date(repair.acceptedAt).getTime();
  const recurrenceMonths = repair.acceptedAt ? monthsBetween(repair.acceptedAt, post.measuredAt) : null;

  // 概率匹配得分：施工范围覆盖 + 原缺陷重叠 + 横向/形态/走向一致性，里程缺口轻微扣分
  const transverseScore = 0.15 * Math.max(0, 1 - transverseGapM / 2);
  const orientationScore = 0.1 * Math.max(0, 1 - orientationDiffDeg / 45);
  let probability =
    0.35 * Math.min(1, scopeCov) +
    0.3 * Math.min(1, origCov) +
    transverseScore +
    (morphMatch ? 0.1 : 0) +
    orientationScore;
  probability -= 0.05 * Math.min(1, cGap / opts.candidateTolM);
  probability = Math.max(0, Math.min(1, probability));

  return {
    repairId: repair.repairId,
    originalFindingId: original.findingId,
    probability,
    deterministicKeyMatch,
    chainageGapM: cGap,
    chainageOverlapM: cOverlap,
    scopeCoverage: scopeCov,
    originalOverlap: origCov,
    transverseGapM,
    orientationDiffDeg,
    morphologyMatch: morphMatch,
    appearedAfterAcceptance,
    recurrenceMonths,
    notes: [],
  };
}

/** 对 (后期检出, 修复) 组成候选并按当前策略给出分类。返回 null 表示该策略下不构成候选。 */
function evaluatePair(
  original: InspectionFinding,
  post: InspectionFinding,
  repair: RepairRecord,
  oi: ResolvedInterval,
  pi: ResolvedInterval,
  opts: ResolvedOptions,
): PairEvaluation | null {
  const candidate = buildCandidate(original, post, repair, oi, pi, opts);

  if (opts.strategy === 'deterministic') {
    // 确定性续接：必须同一构件主键连续，且里程缺口在容差内，否则不生成候选（这正是改造重编的损失点）
    if (!candidate.deterministicKeyMatch || candidate.chainageGapM > opts.keyTolM) return null;
  } else {
    if (candidate.chainageGapM > opts.candidateTolM) return null;
  }

  const overlapsOriginal = candidate.originalOverlap >= 0.2;
  const overlapsScope = candidate.scopeCoverage >= 0.2;
  const strongSpatial =
    candidate.scopeCoverage >= 0.6 &&
    candidate.originalOverlap >= 0.5 &&
    candidate.transverseGapM <= opts.transverseTolM &&
    candidate.morphologyMatch &&
    candidate.orientationDiffDeg <= 35;
  const strategyOk =
    opts.strategy === 'deterministic' ? candidate.deterministicKeyMatch : candidate.probability >= 0.6;

  let cls: RecurrenceClass;
  let reason: string;

  if (repair.status !== 'accepted' || !repair.acceptedAt) {
    if (overlapsOriginal) {
      cls = 'residual_unrepaired';
      reason = `修复 ${repair.repairId} 状态为「${repair.status === 'pending' ? '待验收' : '验收未通过'}」，该位置检出属于尚未闭环的原始缺陷，不计入已验收修复的复发。`;
    } else {
      cls = 'unmatched';
      reason = `无已验收修复与该位置对应。`;
    }
  } else if (!candidate.appearedAfterAcceptance) {
    cls = overlapsOriginal ? 'residual_unrepaired' : 'unmatched';
    reason = `检出时点早于修复验收时点 ${repair.acceptedAt?.slice(0, 10)}，属修复前遗留/待处理，不构成复发。`;
  } else if (strongSpatial && strategyOk) {
    cls = 'confirmed_recurrence';
    reason = `检出区段 ${intervalText(pi.startM, pi.endM)} 落在修复范围 ${intervalText(
      repair.scope.unifiedStartM,
      repair.scope.unifiedEndM,
    )} 内（覆盖 ${pct(candidate.scopeCoverage)}），与原缺陷区段重叠 ${pct(
      candidate.originalOverlap,
    )}，形态与横向偏移一致，晚于验收 ${candidate.recurrenceMonths?.toFixed(1)} 个月 → 同一位置确认复发。`;
  } else if (overlapsOriginal || overlapsScope) {
    cls = 'suspected_recurrence';
    const why: string[] = [];
    if (candidate.scopeCoverage < 0.6) why.push(`修复范围仅覆盖检出的 ${pct(candidate.scopeCoverage)}`);
    if (candidate.originalOverlap < 0.5) why.push(`与原缺陷区段重叠仅 ${pct(candidate.originalOverlap)}`);
    if (!candidate.morphologyMatch) why.push('形态不同');
    if (candidate.transverseGapM > opts.transverseTolM) why.push(`横向偏移差 ${m(candidate.transverseGapM)}`);
    if (!strategyOk) why.push('概率证据不足');
    reason = `${why.join('；')}，无法据此确认为同一修复位置的复发，列为疑似复发并保留候选。`;
  } else {
    cls = 'new_defect';
    reason = `与最近原缺陷 ${original.findingId} 里程相邻（间距 ${m(candidate.chainageGapM)}），但区段不重叠、修复范围覆盖 ${pct(
      candidate.scopeCoverage,
    )}、形态/横向位置不同 → 判为新缺陷，**不**计为复发。`;
  }

  return { candidate, cls, reason };
}

// ---------------- 分类视图（每条后期检出取最佳候选） ----------------

function uncertaintyOf(evals: { candidate: FindingMatchCandidate; cls: RecurrenceClass }[], strategy: MatchStrategy): number {
  if (evals.length === 0) return strategy === 'deterministic' ? 0.9 : 0.75;
  const sorted = [...evals].sort((a, b) => b.candidate.probability - a.candidate.probability);
  const best = sorted[0];
  if (strategy === 'deterministic') {
    return best.cls === 'confirmed_recurrence' ? 0.1 : 0.5;
  }
  const second = sorted[1];
  const margin = second ? Math.max(0, best.candidate.probability - second.candidate.probability) : best.candidate.probability;
  // 最佳概率越低、与次优越接近 → 不确定性越高
  return Math.max(0, Math.min(1, 1 - best.candidate.probability + 0.5 * (1 - Math.min(1, margin * 2))));
}

function withinWindowOf(recurrenceMonths: number | null, windowMonths: number): boolean | null {
  if (recurrenceMonths === null) return null;
  return recurrenceMonths >= 0 && recurrenceMonths <= windowMonths;
}

export function classifyFindings(
  dataset: RecurrenceDataset,
  opts: ResolvedOptions,
): FindingClassification[] {
  const index = assetIndex(dataset);
  const findingsById = new Map(dataset.findings.map((f) => [f.findingId, f]));
  const originalFindingIds = new Set(dataset.repairs.map((r) => r.findingId));

  // 后期检出 = 非任何修复目标，且存在更早的修复目标检出
  const post = dataset.findings.filter((f) => {
    if (originalFindingIds.has(f.findingId)) return false;
    return dataset.repairs.some((r) => {
      const orig = findingsById.get(r.findingId);
      return orig && new Date(orig.measuredAt).getTime() < new Date(f.measuredAt).getTime();
    });
  });

  const out: FindingClassification[] = [];
  for (const p of post) {
    const pi = mapFindingToUnified(dataset, p, index);
    if (!pi) continue;
    const evals: PairEvaluation[] = [];
    for (const repair of dataset.repairs) {
      const orig = findingsById.get(repair.findingId);
      if (!orig) continue;
      if (new Date(orig.measuredAt).getTime() >= new Date(p.measuredAt).getTime()) continue;
      const oi = mapFindingToUnified(dataset, orig, index);
      if (!oi) continue;
      const ev = evaluatePair(orig, p, repair, oi, pi, opts);
      if (ev) evals.push(ev);
    }
    evals.sort((a, b) => b.candidate.probability - a.candidate.probability);
    const best = evals[0];
    const uncertainty = uncertaintyOf(evals, opts.strategy);

    const bestRecurrenceMonths = best?.candidate.recurrenceMonths ?? null;
    const cls: RecurrenceClass = best ? best.cls : 'unmatched';
    // 复发时间仅对“复发”类有意义；新缺陷/未闭环/无匹配不应带复发时间，避免误读
    const isRecurrence = cls === 'confirmed_recurrence' || cls === 'suspected_recurrence';
    const recurrenceMonths = isRecurrence ? bestRecurrenceMonths : null;
    const reason =
      best?.reason ??
      (opts.strategy === 'deterministic'
        ? '确定性续接：改造后构件主键被重编，无同键构件可续接，故无候选（该策略的已知损失）。'
        : '里程容差内无任何修复候选。');

    out.push({
      postFindingId: p.findingId,
      label: p.label,
      periodId: p.periodId,
      unifiedStartM: pi.startM,
      unifiedEndM: pi.endM,
      segmentCount: pi.segments.length,
      strategy: opts.strategy,
      bestRepairId: best?.candidate.repairId ?? null,
      bestOriginalFindingId: best?.candidate.originalFindingId ?? null,
      cls,
      probability: best ? best.candidate.probability : null,
      uncertainty,
      candidates: evals.map((e) => ({
        ...e.candidate,
        notes: e.candidate.notes.concat(`分类：${CLASS_LABELS[e.cls]}`),
      })),
      recurrenceMonths,
      withinWindow: withinWindowOf(recurrenceMonths, opts.windowMonths),
      reason,
    });
  }
  return out;
}

// ---------------- 统计器：已验收修复后 12 个月内的复发比例 ----------------

/** Wilson 95% 置信区间（比例统计区间） */
export function wilsonInterval(k: number, n: number, z = 1.96): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  // 端点取精确值，避免浮点误差把全成功/全失败渲染成 0.9999999
  const low = k === 0 ? 0 : Math.max(0, centre - margin);
  const high = k === n ? 1 : Math.min(1, centre + margin);
  return { low, high };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/**
 * 以「修复」为单位做生存式统计：
 *  - 分母（cohort）：状态 accepted 且验收时点已满 windowMonths 随访的修复；
 *  - 分子：该修复对应后期检出中，最早一条被判为确认/疑似复发且落在窗口内的；
 *  - 超出窗口的复发单独计入 lateRecurrence，不进 12 个月分子。
 */
export function computeStats(
  dataset: RecurrenceDataset,
  opts: ResolvedOptions,
  classifications: FindingClassification[],
): RecurrenceStat {
  const findingsById = new Map(dataset.findings.map((f) => [f.findingId, f]));
  const index = assetIndex(dataset);

  let cohortSize = 0;
  let confirmedWithin12 = 0;
  let suspectedWithin12 = 0;
  let lateRecurrence = 0;
  let none = 0;
  let immature = 0;
  let excludedNotAccepted = 0;
  const recurrenceTimes: number[] = [];

  for (const repair of dataset.repairs) {
    if (repair.status !== 'accepted' || !repair.acceptedAt) {
      excludedNotAccepted++;
      continue;
    }
    const followUp = monthsBetween(repair.acceptedAt, dataset.evaluationAt);
    if (followUp < opts.windowMonths) {
      immature++;
      continue;
    }
    cohortSize++;

    const orig = findingsById.get(repair.findingId);
    if (!orig) {
      none++;
      continue;
    }
    const oi = mapFindingToUnified(dataset, orig, index);
    if (!oi) {
      none++;
      continue;
    }

    // 该修复对应的所有后期检出，逐个直接配对评估（与视图最佳候选独立，确保每笔修复自身闭合）
    const occurrences: PairEvaluation[] = [];
    for (const p of dataset.findings) {
      if (p.periodId === orig.periodId) continue;
      if (new Date(p.measuredAt).getTime() <= new Date(orig.measuredAt).getTime()) continue;
      const pi = mapFindingToUnified(dataset, p, index);
      if (!pi) continue;
      const ev = evaluatePair(orig, p, repair, oi, pi, opts);
      if (!ev) continue;
      if (ev.cls === 'confirmed_recurrence' || ev.cls === 'suspected_recurrence') occurrences.push(ev);
    }

    if (occurrences.length === 0) {
      none++;
      continue;
    }
    occurrences.sort((a, b) => new Date(a.candidate.recurrenceMonths ?? 0).getTime() - new Date(b.candidate.recurrenceMonths ?? 0).getTime());
    const first = occurrences[0];
    const months = first.candidate.recurrenceMonths ?? 0;
    if (months >= 0 && months <= opts.windowMonths) {
      if (first.cls === 'confirmed_recurrence') confirmedWithin12++;
      else suspectedWithin12++;
      recurrenceTimes.push(months);
    } else {
      lateRecurrence++;
    }
  }

  const n = cohortSize;
  const newDefect = classifications.filter((c) => c.cls === 'new_defect').length;
  const residual = classifications.filter((c) => c.cls === 'residual_unrepaired').length;

  return {
    cohortSize: n,
    confirmedWithin12,
    suspectedWithin12,
    newDefect,
    residual,
    none,
    lateRecurrence,
    matchedRepairs: confirmedWithin12 + suspectedWithin12 + lateRecurrence,
    confirmedRate: n ? confirmedWithin12 / n : 0,
    suspectedRate: n ? suspectedWithin12 / n : 0,
    combinedRate: n ? (confirmedWithin12 + suspectedWithin12) / n : 0,
    confirmedCI: wilsonInterval(confirmedWithin12, n),
    suspectedCI: wilsonInterval(suspectedWithin12, n),
    combinedCI: wilsonInterval(confirmedWithin12 + suspectedWithin12, n),
    medianRecurrenceMonths: median(recurrenceTimes),
    immature,
    pending: excludedNotAccepted,
    excludedNotAccepted,
  };
}

/** 顶层入口：给定策略产出资产映射、谱系核验、分类与统计 */
export function analyzeRecurrence(dataset: RecurrenceDataset, options: RecurrenceOptions): RecurrenceAnalysis {
  const opts = resolveOptions(options);
  const assetMap = buildAssetMap(dataset);
  const lineageChecks = verifyLineage(dataset);
  const classifications = classifyFindings(dataset, opts);
  const stats = computeStats(dataset, opts, classifications);
  return {
    strategy: opts.strategy,
    assetMap,
    lineageChecks,
    lineageOk: lineageChecks.every((c) => c.ok),
    classifications,
    stats,
  };
}
