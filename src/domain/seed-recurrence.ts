// ============================================================
// 缺陷复发率数据集 · 样例
//
// 结构：某连续箱梁 K2+300~K2+520，统一局部里程 0~220 m。
// 2024 年首次检测（P1）后对若干裂缝做了修复；改造时将箱梁 G1（0~120 m）
// 在 60 m 处拆分为 G1a/G1b（主键重编），G2（120~220 m）保留。
// 随后 P2/P3/P4 三次复查。
//
// 覆盖题目要求的全部情形：
//   • 构件拆分：G1 → G1a + G1b（统一里程并集连续）
//   • 同一裂缝延伸跨过新边界：F-B (55~63) → F-B' (55~67)，横跨 60 m 接缝
//   • 修复范围覆盖一半裂缝：F-A (88~94) 只修复 88~91
//   • 邻近新裂缝：F-G (160~163) 与 F-G' (164~167) 里程相邻但横向/形态不同
//   • 超窗复发：F-C' 在验收后约 18 个月检出（>12 个月，不进 12 个月内分子）
//   • 随访不足：R-I 验收仅约 9 个月即检出（不进分母）
//   • 未验收：R-P 状态 pending，检出按“未闭环遗留”而非复发处理
// ============================================================

import type {
  AcceptanceEvidence,
  AssetNode,
  FindingSegment,
  InspectionFinding,
  RepairRecord,
  RecurrenceDataset,
} from '../types';
import { sha256HexSync } from './sha256';

const ev = (id: string, kind: AcceptanceEvidence['kind'], label: string): AcceptanceEvidence => ({
  evidenceId: id,
  kind,
  label,
  sha256Ref: sha256HexSync(`${id}|${kind}|${label}`),
});

// ---------- 构件谱系 ----------

const P1_ASSETS: AssetNode[] = [
  {
    assetId: 'G1',
    periodId: 'P1',
    label: '箱梁 G1（K2+300~K2+420，原始）',
    kind: 'box_girder',
    lineageKey: 'LIN-G1',
    unifiedStartM: 0,
    unifiedEndM: 120,
    derivedFrom: [],
    derivation: 'original',
  },
  {
    assetId: 'G2',
    periodId: 'P1',
    label: '箱梁 G2（K2+420~K2+520，原始）',
    kind: 'box_girder',
    lineageKey: 'LIN-G2',
    unifiedStartM: 120,
    unifiedEndM: 220,
    derivedFrom: [],
    derivation: 'original',
  },
];

/** P2 起：G1 在 60 m 处拆分重编为 G1a/G1b，G2 保留 */
function splitAssets(periodId: string): AssetNode[] {
  return [
    {
      assetId: 'G1a',
      periodId,
      label: '箱梁 G1 拆分段 a（K2+300~K2+360）',
      kind: 'box_girder',
      lineageKey: 'LIN-G1',
      unifiedStartM: 0,
      unifiedEndM: 60,
      derivedFrom: ['G1'],
      derivation: periodId === 'P2' ? 'split' : 'retained',
    },
    {
      assetId: 'G1b',
      periodId,
      label: '箱梁 G1 拆分段 b（K2+360~K2+420）',
      kind: 'box_girder',
      lineageKey: 'LIN-G1',
      unifiedStartM: 60,
      unifiedEndM: 120,
      derivedFrom: ['G1'],
      derivation: periodId === 'P2' ? 'split' : 'retained',
    },
    {
      assetId: 'G2',
      periodId,
      label: '箱梁 G2（K2+420~K2+520，保留）',
      kind: 'box_girder',
      lineageKey: 'LIN-G2',
      unifiedStartM: 120,
      unifiedEndM: 220,
      derivedFrom: [],
      derivation: 'retained',
    },
  ];
}

// ---------- 检出 ----------

const seg = (assetId: string, fromOffsetM: number, toOffsetM: number): FindingSegment => ({
  assetId,
  fromOffsetM,
  toOffsetM,
});

const P1_DATE = '2024-03-01T09:30:00+08:00';
const P2_DATE = '2025-04-15T09:30:00+08:00';
const P3_DATE = '2025-11-10T09:30:00+08:00';
const P4_DATE = '2026-02-10T09:30:00+08:00';

const P1_FINDINGS: InspectionFinding[] = [
  {
    findingId: 'F-A',
    periodId: 'P1',
    label: 'W-A 腹板斜裂缝（仅修复一半）',
    morphology: 'diagonal',
    orientationDeg: 55,
    transverseOffsetM: 0,
    widthMm: 1.2,
    lengthM: 6,
    measuredAt: P1_DATE,
    segments: [seg('G1', 88, 94)], // 统一里程 88~94
  },
  {
    findingId: 'F-B',
    periodId: 'P1',
    label: 'W-B 跨缝斜裂缝（修复后跨越新边界延伸）',
    morphology: 'diagonal',
    orientationDeg: 60,
    transverseOffsetM: 0,
    widthMm: 1.5,
    lengthM: 8,
    measuredAt: P1_DATE,
    segments: [seg('G1', 55, 63)], // 统一里程 55~63，跨 60 m 接缝
  },
  {
    findingId: 'F-C',
    periodId: 'P1',
    label: 'J-C 接缝裂缝（超窗复发样例）',
    morphology: 'joint',
    orientationDeg: 90,
    transverseOffsetM: 0,
    widthMm: 0.8,
    lengthM: 4,
    measuredAt: P1_DATE,
    segments: [seg('G2', 20, 24)], // 统一里程 140~144
  },
  {
    findingId: 'F-S',
    periodId: 'P1',
    label: 'W-S 腹板斜裂缝（延伸型疑似复发样例）',
    morphology: 'diagonal',
    orientationDeg: 50,
    transverseOffsetM: 0.3,
    widthMm: 1.0,
    lengthM: 6,
    measuredAt: P1_DATE,
    segments: [seg('G2', 30, 36)], // 统一里程 150~156
  },
  {
    findingId: 'F-G',
    periodId: 'P1',
    label: 'W-G 腹板斜裂缝（邻近新裂缝样例的原缺陷）',
    morphology: 'diagonal',
    orientationDeg: 55,
    transverseOffsetM: 0,
    widthMm: 0.7,
    lengthM: 3,
    measuredAt: P1_DATE,
    segments: [seg('G2', 40, 43)], // 统一里程 160~163
  },
  {
    findingId: 'F-D',
    periodId: 'P1',
    label: 'L-D 纵向裂缝（修复闭环无复发）',
    morphology: 'longitudinal',
    orientationDeg: 5,
    transverseOffsetM: 0,
    widthMm: 0.6,
    lengthM: 3,
    measuredAt: P1_DATE,
    segments: [seg('G2', 60, 63)], // 统一里程 180~183
  },
  {
    findingId: 'F-P',
    periodId: 'P1',
    label: 'W-P 底板斜裂缝（修复未验收）',
    morphology: 'diagonal',
    orientationDeg: 45,
    transverseOffsetM: 0,
    widthMm: 1.1,
    lengthM: 2,
    measuredAt: P1_DATE,
    segments: [seg('G2', 70, 72)], // 统一里程 190~192
  },
];

const P2_FINDINGS: InspectionFinding[] = [
  {
    findingId: 'F-A2',
    periodId: 'P2',
    label: "W-A' 修复后原位复裂",
    morphology: 'diagonal',
    orientationDeg: 55,
    transverseOffsetM: 0,
    widthMm: 1.4,
    lengthM: 3,
    measuredAt: P2_DATE,
    segments: [seg('G1b', 28, 31)], // 统一里程 88~91（落在已修复的半段内）
  },
  {
    findingId: 'F-B2',
    periodId: 'P2',
    label: "W-B' 跨新缝延伸（拆分后跨 G1a/G1b）",
    morphology: 'diagonal',
    orientationDeg: 60,
    transverseOffsetM: 0,
    widthMm: 1.8,
    lengthM: 12,
    measuredAt: P2_DATE,
    segments: [seg('G1a', 55, 60), seg('G1b', 0, 7)], // 统一里程 55~67，跨 60 m 接缝
  },
  {
    findingId: 'F-S2',
    periodId: 'P2',
    label: "W-S' 延伸型复裂",
    morphology: 'diagonal',
    orientationDeg: 52,
    transverseOffsetM: 0.3,
    widthMm: 1.2,
    lengthM: 7,
    measuredAt: P2_DATE,
    segments: [seg('G2', 33, 40)], // 统一里程 153~160
  },
  {
    findingId: 'F-G2',
    periodId: 'P2',
    label: "L-G' 邻近新裂缝（横向偏移 2 m、走向不同）",
    morphology: 'longitudinal',
    orientationDeg: 8,
    transverseOffsetM: 2.0,
    widthMm: 0.5,
    lengthM: 3,
    measuredAt: P2_DATE,
    segments: [seg('G2', 44, 47)], // 统一里程 164~167
  },
  {
    findingId: 'F-P2',
    periodId: 'P2',
    label: "W-P' 未验收修复处仍见裂缝（未闭环遗留）",
    morphology: 'diagonal',
    orientationDeg: 45,
    transverseOffsetM: 0,
    widthMm: 1.1,
    lengthM: 2,
    measuredAt: P2_DATE,
    segments: [seg('G2', 70, 72)], // 统一里程 190~192（修复 R-P 待验收）
  },
  {
    findingId: 'F-I',
    periodId: 'P2',
    label: 'W-I 底板斜裂缝（新一轮修复目标）',
    morphology: 'diagonal',
    orientationDeg: 40,
    transverseOffsetM: 0,
    widthMm: 0.9,
    lengthM: 3,
    measuredAt: P2_DATE,
    segments: [seg('G2', 0, 3)], // 统一里程 120~123
  },
];

const P3_FINDINGS: InspectionFinding[] = [
  {
    findingId: 'F-C3',
    periodId: 'P3',
    label: "J-C' 接缝处复裂（验收后约 18 个月，超窗）",
    morphology: 'joint',
    orientationDeg: 90,
    transverseOffsetM: 0,
    widthMm: 1.0,
    lengthM: 4,
    measuredAt: P3_DATE,
    segments: [seg('G2', 20, 24)], // 统一里程 140~144
  },
];

const P4_FINDINGS: InspectionFinding[] = [
  {
    findingId: 'F-I4',
    periodId: 'P4',
    label: "W-I' 修复后复裂（验收仅约 5 个月，随访不足 12 个月）",
    morphology: 'diagonal',
    orientationDeg: 40,
    transverseOffsetM: 0,
    widthMm: 1.0,
    lengthM: 3,
    measuredAt: P4_DATE,
    segments: [seg('G2', 0, 3)], // 统一里程 120~123
  },
];

// ---------- 修复账 ----------

const REPAIRS: RepairRecord[] = [
  {
    repairId: 'R-A',
    findingId: 'F-A',
    periodId: 'P1',
    scope: { unifiedStartM: 88, unifiedEndM: 91 }, // 只覆盖原裂缝 88~94 的一半
    material: '环氧树脂压力灌浆 + 局部碳纤维布',
    completedAt: '2024-04-20T16:00:00+08:00',
    acceptedAt: '2024-05-10T10:00:00+08:00',
    status: 'accepted',
    acceptanceEvidence: [
      ev('EV-A1', 'material_cert', '环氧灌浆料合格证与配比记录'),
      ev('EV-A2', 'acceptance_photo', '修复半段压浆前后对比照'),
    ],
  },
  {
    repairId: 'R-B',
    findingId: 'F-B',
    periodId: 'P1',
    scope: { unifiedStartM: 55, unifiedEndM: 63 }, // 全范围
    material: '环氧树脂压力灌浆 + 钢板条带',
    completedAt: '2024-04-22T16:00:00+08:00',
    acceptedAt: '2024-05-10T10:00:00+08:00',
    status: 'accepted',
    acceptanceEvidence: [
      ev('EV-B1', 'construction_record', '跨缝钢板条带施工记录'),
      ev('EV-B2', 'third_party', '第三方复核：压浆饱满度抽检合格'),
    ],
  },
  {
    repairId: 'R-C',
    findingId: 'F-C',
    periodId: 'P1',
    scope: { unifiedStartM: 140, unifiedEndM: 144 },
    material: '接缝密封胶 + 柔性止水带',
    completedAt: '2024-04-25T16:00:00+08:00',
    acceptedAt: '2024-05-10T10:00:00+08:00',
    status: 'accepted',
    acceptanceEvidence: [ev('EV-C1', 'acceptance_photo', '接缝修复验收照片')],
  },
  {
    repairId: 'R-S',
    findingId: 'F-S',
    periodId: 'P1',
    scope: { unifiedStartM: 150, unifiedEndM: 156 },
    material: '环氧树脂压力灌浆',
    completedAt: '2024-04-26T16:00:00+08:00',
    acceptedAt: '2024-05-10T10:00:00+08:00',
    status: 'accepted',
    acceptanceEvidence: [ev('EV-S1', 'material_cert', '灌浆料合格证')],
  },
  {
    repairId: 'R-G',
    findingId: 'F-G',
    periodId: 'P1',
    scope: { unifiedStartM: 160, unifiedEndM: 163 },
    material: '环氧树脂压力灌浆',
    completedAt: '2024-04-27T16:00:00+08:00',
    acceptedAt: '2024-05-10T10:00:00+08:00',
    status: 'accepted',
    acceptanceEvidence: [ev('EV-G1', 'acceptance_photo', '修复后外观检查')],
  },
  {
    repairId: 'R-D',
    findingId: 'F-D',
    periodId: 'P1',
    scope: { unifiedStartM: 180, unifiedEndM: 183 },
    material: '纵缝压力注胶',
    completedAt: '2024-04-28T16:00:00+08:00',
    acceptedAt: '2024-05-10T10:00:00+08:00',
    status: 'accepted',
    acceptanceEvidence: [ev('EV-D1', 'third_party', '注胶密实度检测合格')],
  },
  {
    repairId: 'R-P',
    findingId: 'F-P',
    periodId: 'P1',
    scope: { unifiedStartM: 190, unifiedEndM: 192 },
    material: '环氧树脂压力灌浆',
    completedAt: '2025-03-01T16:00:00+08:00',
    acceptedAt: null, // 尚未验收
    status: 'pending',
    acceptanceEvidence: [ev('EV-P1', 'construction_record', '施工记录（待监理验收）')],
  },
  {
    repairId: 'R-I',
    findingId: 'F-I',
    periodId: 'P2',
    scope: { unifiedStartM: 120, unifiedEndM: 123 },
    material: '环氧树脂压力灌浆',
    completedAt: '2025-09-05T16:00:00+08:00',
    acceptedAt: '2025-09-20T10:00:00+08:00', // 距评估时点不足 12 个月
    status: 'accepted',
    acceptanceEvidence: [ev('EV-I1', 'material_cert', '灌浆料合格证')],
  },
];

/** 组装完整数据集（每次返回新对象，避免调用方修改污染模块常量） */
export function buildRecurrenceDataset(): RecurrenceDataset {
  return {
    projectId: 'P',
    structureLabel: 'K2+300~K2+520 连续箱梁（G1 于 K2+360 处拆分重编）',
    evaluationAt: '2026-06-30T23:59:59+08:00',
    windowMonths: 12,
    periods: [
      { periodId: 'P1', label: 'P1 · 2024 年首次检测', inspectedAt: P1_DATE, note: '发现 W-A/W-B/J-C 等多条裂缝并修复。' },
      { periodId: 'P2', label: 'P2 · 2025 年春季复查', inspectedAt: P2_DATE, note: 'G1 已于 K2+360 处拆分重编为 G1a/G1b。' },
      { periodId: 'P3', label: 'P3 · 2025 年秋季复查', inspectedAt: P3_DATE, note: '复查接缝处复裂。' },
      { periodId: 'P4', label: 'P4 · 2026 年初复查', inspectedAt: P4_DATE, note: '复查新一轮修复。' },
    ],
    assets: [...P1_ASSETS, ...splitAssets('P2'), ...splitAssets('P3'), ...splitAssets('P4')],
    findings: [...P1_FINDINGS, ...P2_FINDINGS, ...P3_FINDINGS, ...P4_FINDINGS],
    repairs: REPAIRS,
  };
}

let cached: RecurrenceDataset | null = null;
/** 演示默认数据集（惰性单例） */
export function getRecurrenceDataset(): RecurrenceDataset {
  if (!cached) cached = buildRecurrenceDataset();
  return cached;
}
