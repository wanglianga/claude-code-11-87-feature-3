import { describe, expect, it } from 'vitest';
import {
  analyzeRecurrence,
  buildAssetMap,
  classifyFindings,
  computeStats,
  mapFindingToUnified,
  verifyLineage,
  wilsonInterval,
  DEFAULT_WINDOW_MONTHS,
  type ResolvedOptions,
} from './recurrence';
import { buildRecurrenceDataset } from './seed-recurrence';
import type { FindingClassification, MatchStrategy, RecurrenceDataset } from '../types';

const ds = (): RecurrenceDataset => buildRecurrenceDataset();

function classify(strategy: MatchStrategy, dataset = ds()): FindingClassification[] {
  return analyzeRecurrence(dataset, { strategy }).classifications;
}

function byId(list: FindingClassification[], id: string): FindingClassification {
  const f = list.find((c) => c.postFindingId === id);
  if (!f) throw new Error(`未找到后期检出 ${id}`);
  return f;
}

describe('资产谱系 → 统一局部里程映射', () => {
  it('拆分后子构件统一里程并集与父构件一致，且各期覆盖连续', () => {
    const checks = verifyLineage(ds());
    expect(checks.every((c) => c.ok)).toBe(true);
    const split = checks.find((c) => c.label.startsWith('拆分：'));
    expect(split?.ok).toBe(true);
    // 四个检测期各一条覆盖连续性检查
    expect(checks.filter((c) => c.label.startsWith('覆盖连续性：'))).toHaveLength(4);
  });

  it('同一裂缝跨新边界后，两个区段拼接为连续里程', () => {
    const d = ds();
    const fB2 = d.findings.find((f) => f.findingId === 'F-B2')!;
    const mapped = mapFindingToUnified(d, fB2)!;
    expect(mapped.segments).toHaveLength(2);
    expect(mapped.startM).toBeCloseTo(55);
    expect(mapped.endM).toBeCloseTo(67);
    const crossCheck = verifyLineage(d).find((c) => c.label.startsWith('跨缝映射：'));
    expect(crossCheck?.ok).toBe(true);
  });

  it('资产谱系表按检测期、里程排序，便于逐条复核', () => {
    const rows = buildAssetMap(ds());
    const p1 = rows.filter((r) => r.periodId === 'P1');
    expect(p1.map((r) => r.assetId)).toEqual(['G1', 'G2']);
    expect(p1[0].unifiedStartM).toBe(0);
    const p2 = rows.filter((r) => r.periodId === 'P2');
    expect(p2.map((r) => r.assetId)).toEqual(['G1a', 'G1b', 'G2']);
    expect(p2[0].derivation).toBe('split');
  });
});

describe('概率匹配：覆盖跨拆分边界、修复半段与邻近新裂缝', () => {
  const list = classify('probabilistic');

  it('修复范围内（半段覆盖）原位复裂 → 确认复发', () => {
    const c = byId(list, 'F-A2');
    expect(c.cls).toBe('confirmed_recurrence');
    expect(c.recurrenceMonths).toBeGreaterThan(10);
    expect(c.recurrenceMonths).toBeLessThan(12);
    expect(c.withinWindow).toBe(true);
  });

  it('跨新边界延伸的同一裂缝 → 确认复发（概率匹配可续接重编后的主键）', () => {
    const c = byId(list, 'F-B2');
    expect(c.cls).toBe('confirmed_recurrence');
    expect(c.bestOriginalFindingId).toBe('F-B');
  });

  it('部分重叠、证据不足 → 疑似复发并保留全部候选', () => {
    const c = byId(list, 'F-S2');
    expect(c.cls).toBe('suspected_recurrence');
    expect(c.candidates.length).toBeGreaterThan(0);
    expect(c.uncertainty).toBeGreaterThan(0);
  });

  it('里程相邻但横向/形态不同的邻近裂缝 → 新缺陷，不计为复发', () => {
    const c = byId(list, 'F-G2');
    expect(c.cls).toBe('new_defect');
    // 注意：它与 F-G 里程相邻（间距 1 m），但绝不能自动算作复发
    expect(c.recurrenceMonths).toBeNull();
    expect(c.withinWindow).toBeNull();
  });

  it('未验收修复处的检出 → 未闭环遗留，而非复发', () => {
    const c = byId(list, 'F-P2');
    expect(c.cls).toBe('residual_unrepaired');
  });
});

describe('确定性续接：主键重编会损失匹配', () => {
  const det = classify('deterministic');
  const prob = classify('probabilistic');

  it('拆分重编后，确定性续接无法匹配原主键 → 丢失跨边界与半段复发', () => {
    expect(byId(det, 'F-A2').cls).toBe('unmatched');
    expect(byId(det, 'F-B2').cls).toBe('unmatched');
    // 概率匹配能覆盖这些
    expect(byId(prob, 'F-A2').cls).toBe('confirmed_recurrence');
    expect(byId(prob, 'F-B2').cls).toBe('confirmed_recurrence');
  });

  it('主键未变（G2 保留）的位置，两种策略都判为同一类', () => {
    for (const id of ['F-S2', 'F-G2', 'F-P2', 'F-C3']) {
      expect(byId(det, id).cls).toBe(byId(prob, id).cls);
    }
  });
});

describe('统计器：已验收修复后 12 个月内复发比例', () => {
  it('概率匹配下的分母、分子与分类计数符合样本设计', () => {
    const r = analyzeRecurrence(ds(), { strategy: 'probabilistic' });
    const s = r.stats;
    // 6 笔已验收且随访满 12 个月的修复构成分母
    expect(s.cohortSize).toBe(6);
    expect(s.confirmedWithin12).toBe(2); // R-A, R-B
    expect(s.suspectedWithin12).toBe(1); // R-S
    expect(s.lateRecurrence).toBe(1); // R-C（18 个月，超窗）
    expect(s.none).toBe(2); // R-G（新缺陷）、R-D（无复发）
    expect(s.immature).toBe(1); // R-I 随访不足
    expect(s.excludedNotAccepted).toBe(1); // R-P 未验收
    expect(s.confirmedRate).toBeCloseTo(2 / 6, 5);
    expect(s.combinedRate).toBeCloseTo(3 / 6, 5);
  });

  it('确定性策略因主键重编丢匹配，确认复发分子显著偏低', () => {
    const s = analyzeRecurrence(ds(), { strategy: 'deterministic' }).stats;
    expect(s.cohortSize).toBe(6);
    expect(s.confirmedWithin12).toBe(0); // F-A2/F-B2 均丢失
    expect(s.suspectedWithin12).toBe(1); // 仅 R-S（主键 G2 未变）
  });

  it('超窗复发不计入 12 个月分子，但归类仍为复发', () => {
    const r = analyzeRecurrence(ds(), { strategy: 'probabilistic' });
    const c = byId(r.classifications, 'F-C3');
    expect(c.cls).toBe('confirmed_recurrence');
    expect(c.recurrenceMonths).toBeGreaterThan(12);
    expect(c.withinWindow).toBe(false);
    expect(r.stats.lateRecurrence).toBe(1);
  });

  it('Wilson 置信区间在 0/1 边界与常规比例下都合法', () => {
    const a = wilsonInterval(0, 6);
    expect(a.low).toBe(0);
    expect(a.high).toBeGreaterThan(0);
    expect(a.high).toBeLessThan(1);
    const b = wilsonInterval(6, 6);
    expect(b.high).toBe(1);
    expect(b.low).toBeLessThan(1);
    const c = wilsonInterval(3, 6);
    expect(c.low).toBeLessThan(0.5);
    expect(c.high).toBeGreaterThan(0.5);
    const empty = wilsonInterval(0, 0);
    expect(empty).toEqual({ low: 0, high: 0 });
  });

  it('观察窗口可由调用方覆盖', () => {
    const opts: ResolvedOptions = {
      strategy: 'probabilistic',
      windowMonths: 24,
      candidateTolM: 6,
      keyTolM: 2,
      transverseTolM: 1.2,
    };
    const c = classifyFindings(ds(), opts);
    // 24 个月窗口下，R-C（18 个月）应落入窗口
    expect(byId(c, 'F-C3').withinWindow).toBe(true);
    const stats = computeStats(ds(), opts, c);
    expect(stats.lateRecurrence).toBe(0);
    expect(stats.confirmedWithin12).toBe(3); // R-A, R-B, R-C
  });
});

describe('核心纪律：一次相邻位置检出不得自动算作复发', () => {
  it('F-G2 与 F-G 里程仅差 1 m，但被明确判为新缺陷', () => {
    const c = byId(classify('probabilistic'), 'F-G2');
    expect(c.cls).toBe('new_defect');
    expect(c.reason).toMatch(/新缺陷/);
  });
});

it('默认窗口常量为 12 个月', () => {
  expect(DEFAULT_WINDOW_MONTHS).toBe(12);
});
