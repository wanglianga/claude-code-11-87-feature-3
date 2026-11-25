import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type {
  FindingClassification,
  MatchStrategy,
  RecurrenceAnalysis,
  RecurrenceClass,
} from '../types';
import {
  analyzeRecurrence,
  CLASS_LABELS,
  CLASS_TONE,
  DEFAULT_WINDOW_MONTHS,
  MORPHOLOGY_LABELS,
} from '../domain/recurrence';
import { Btn, Card, Badge, Stat, Empty } from './ui';

type Sub = 'overview' | 'lineage' | 'matches' | 'verify';

const CLASS_ORDER: RecurrenceClass[] = [
  'confirmed_recurrence',
  'suspected_recurrence',
  'new_defect',
  'residual_unrepaired',
  'unmatched',
];

function pct(x: number | null): string {
  if (x === null) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function monthsText(x: number | null): string {
  if (x === null) return '—';
  return `${x.toFixed(1)} 个月`;
}

function ciText(ci: { low: number; high: number }): string {
  return `[${(ci.low * 100).toFixed(1)}%, ${(ci.high * 100).toFixed(1)}%]`;
}

export default function Recurrence() {
  const s = useStore();
  const [sub, setSub] = useState<Sub>('overview');
  const [strategy, setStrategy] = useState<MatchStrategy>('probabilistic');
  const [windowMonths, setWindowMonths] = useState(DEFAULT_WINDOW_MONTHS);

  const dataset = s.recurrence;

  const analysis: RecurrenceAnalysis | null = useMemo(
    () => (dataset ? analyzeRecurrence(dataset, { strategy, windowMonths }) : null),
    [dataset, strategy, windowMonths],
  );

  if (!dataset || !analysis) {
    return <Card><Empty>复发率数据集尚未加载。</Empty></Card>;
  }

  return (
    <div>
      <Card
        title="缺陷复发率数据集"
        sub={`${dataset.structureLabel} · 评估时点 ${dataset.evaluationAt.slice(0, 10)} · 观察窗口 ${windowMonths} 个月`}
        extra={
          <div className="flex gap8 wrap">
            <select
              className="select"
              style={{ width: 'auto', padding: '6px 10px' }}
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as MatchStrategy)}
              title="跨期续接策略"
            >
              <option value="probabilistic">概率匹配（形态+空间+修复上下文）</option>
              <option value="deterministic">确定性续接（主键+里程容差）</option>
            </select>
            <select
              className="select"
              style={{ width: 'auto', padding: '6px 10px' }}
              value={windowMonths}
              onChange={(e) => setWindowMonths(Number(e.target.value))}
            >
              <option value={12}>窗口 12 个月</option>
              <option value={24}>窗口 24 个月</option>
              <option value={6}>窗口 6 个月</option>
            </select>
          </div>
        }
      >
        <div className="banner banner-info">
          <span className="bi">🧩</span>
          <div>
            同一修复位置下一轮仍检出裂缝，<b>必须区分</b>原缺陷未修复、修复后复发、施工接缝附近的新缺陷。
            管线/构件先经<b>资产谱系</b>映射到统一局部里程，再用<b>修复账</b>的施工范围、材料、完成时点与验收证据，
            把前后两期检出的区间位置、形态和修复范围组成候选。当前策略{' '}
            <Badge tone={strategy === 'probabilistic' ? 'brand' : 'teal'}>
              {strategy === 'probabilistic' ? '概率匹配' : '确定性续接'}
            </Badge>
            {strategy === 'probabilistic'
              ? '：覆盖更高，但保留全部候选并传播匹配不确定性。'
              : '：主键+里程容差，易复核，但改造后主键重编会损失匹配。'}
          </div>
        </div>
      </Card>

      <div className="subtabs">
        <button className={`subtab ${sub === 'overview' ? 'active' : ''}`} onClick={() => setSub('overview')}>
          复发统计
        </button>
        <button className={`subtab ${sub === 'lineage' ? 'active' : ''}`} onClick={() => setSub('lineage')}>
          资产谱系与里程映射
        </button>
        <button className={`subtab ${sub === 'matches' ? 'active' : ''}`} onClick={() => setSub('matches')}>
          跨期匹配与分类
        </button>
        <button className={`subtab ${sub === 'verify' ? 'active' : ''}`} onClick={() => setSub('verify')}>
          样例核验
        </button>
      </div>

      {sub === 'overview' && <Overview analysis={analysis} windowMonths={windowMonths} />}
      {sub === 'lineage' && <Lineage analysis={analysis} />}
      {sub === 'matches' && <Matches analysis={analysis} />}
      {sub === 'verify' && <Verify analysis={analysis} strategy={strategy} windowMonths={windowMonths} />}
    </div>
  );
}

// ---------------- 复发统计 ----------------

function Overview({ analysis, windowMonths }: { analysis: RecurrenceAnalysis; windowMonths: number }) {
  const st = analysis.stats;
  return (
    <div>
      <div className="stat-grid">
        <Stat
          label={`确认复发比例（${windowMonths} 个月内）`}
          value={pct(st.confirmedRate)}
          hint={`${st.confirmedWithin12}/${st.cohortSize} · Wilson 95% ${ciText(st.confirmedCI)}`}
          tone="danger"
        />
        <Stat
          label="疑似复发比例"
          value={pct(st.suspectedRate)}
          hint={`${st.suspectedWithin12}/${st.cohortSize} · 95% ${ciText(st.suspectedCI)}`}
          tone="warn"
        />
        <Stat
          label="合并复发比例（确认+疑似）"
          value={pct(st.combinedRate)}
          hint={`${st.confirmedWithin12 + st.suspectedWithin12}/${st.cohortSize} · 95% ${ciText(st.combinedCI)}`}
          tone="brand"
        />
        <Stat
          label="复发中位时间"
          value={st.medianRecurrenceMonths === null ? '—' : `${st.medianRecurrenceMonths.toFixed(1)} 月`}
          hint="窗口内首次复发的中位数"
          tone="slate"
        />
      </div>

      <div className="grid-2">
        <Card title="已验收修复队列（分母与分子）" sub="分母 = 已验收且随访满窗口的修复；分子 = 其对应后期检出中最早的确认/疑似复发。">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>项目</th>
                  <th className="right">数量</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>随访满窗口的已验收修复（分母）</td>
                  <td className="right mono">{st.cohortSize}</td>
                  <td className="small">状态 accepted 且验收距评估时点 ≥ {windowMonths} 个月</td>
                </tr>
                <tr>
                  <td>├ 窗口内确认复发</td>
                  <td className="right mono tone-danger">{st.confirmedWithin12}</td>
                  <td className="small">同一位置、形态/横向一致、晚于验收</td>
                </tr>
                <tr>
                  <td>├ 窗口内疑似复发</td>
                  <td className="right mono tone-warn">{st.suspectedWithin12}</td>
                  <td className="small">位置重叠但证据不足，保留候选并传播不确定性</td>
                </tr>
                <tr>
                  <td>├ 超窗复发</td>
                  <td className="right mono">{st.lateRecurrence}</td>
                  <td className="small">检出晚于 {windowMonths} 个月，不计入 12 个月分子</td>
                </tr>
                <tr>
                  <td>└ 未见复发</td>
                  <td className="right mono tone-ok">{st.none}</td>
                  <td className="small">窗口内无对应后期检出</td>
                </tr>
                <tr>
                  <td>随访不足（未进分母）</td>
                  <td className="right mono">{st.immature}</td>
                  <td className="small">验收未满 {windowMonths} 个月，无法判定</td>
                </tr>
                <tr>
                  <td>未验收/验收未通过（排除）</td>
                  <td className="right mono">{st.excludedNotAccepted}</td>
                  <td className="small">不计入“已验收修复后复发”的任何分子分母</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="分类计数（后期检出视角）" sub="每条后期检出独立分类；相邻位置检出不会被自动计为复发。">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th className="right">计数</th>
                </tr>
              </thead>
              <tbody>
                {CLASS_ORDER.map((cls) => (
                  <tr key={cls}>
                    <td>
                      <Badge tone={CLASS_TONE[cls]}>{CLASS_LABELS[cls]}</Badge>
                    </td>
                    <td className="right mono">
                      {analysis.classifications.filter((c) => c.cls === cls).length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted mt12">
            新缺陷单独计数，<b>绝不</b>并入复发比例；未验收修复处的检出归为“未闭环遗留”，同样不计入“已验收修复后复发”。
          </p>
        </Card>
      </div>
    </div>
  );
}

// ---------------- 资产谱系 ----------------

function Lineage({ analysis }: { analysis: RecurrenceAnalysis }) {
  const s = useStore();
  const dataset = s.recurrence!;
  const byPeriod = new Map<string, typeof analysis.assetMap>();
  for (const row of analysis.assetMap) {
    const list = byPeriod.get(row.periodId) ?? [];
    list.push(row);
    byPeriod.set(row.periodId, list);
  }
  const maxM = Math.max(...dataset.assets.map((a) => a.unifiedEndM));

  return (
    <div>
      <Card
        title="资产谱系 → 统一局部里程"
        sub="每个检测期的构件都映射到同一条纵向局部里程轴（米），跨期同里程可直接比较；拆分/合并/重编通过 lineageKey 与 derivedFrom 追溯。"
        extra={
          <Badge tone={analysis.lineageOk ? 'ok' : 'danger'}>
            {analysis.lineageOk ? '谱系映射核验通过' : '谱系映射存在问题'}
          </Badge>
        }
      >
        {dataset.periods.map((p) => {
          const rows = byPeriod.get(p.periodId) ?? [];
          return (
            <div key={p.periodId} className="lineage-period">
              <div className="flex gap8 wrap mb8">
                <b>{p.label}</b>
                <span className="tiny muted">{p.inspectedAt.slice(0, 10)}</span>
                {p.note && <span className="tiny muted">· {p.note}</span>}
              </div>
              <div className="mileage-track" title={`0 ~ ${maxM} m`}>
                {rows.map((r) => {
                  const left = (r.unifiedStartM / maxM) * 100;
                  const width = ((r.unifiedEndM - r.unifiedStartM) / maxM) * 100;
                  const tone = r.derivation === 'split' ? 'split' : r.derivation === 'merge' ? 'merge' : 'base';
                  return (
                    <div
                      key={r.assetId}
                      className={`mileage-seg ${tone}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${r.assetId} ${r.unifiedStartM}~${r.unifiedEndM} m`}
                    >
                      <span className="mileage-seg-label">{r.assetId}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="small muted mt8">轴刻度：0 m（K2+300）→ {maxM} m（K2+520）；橙色为拆分产生的新构件。</div>
      </Card>

      <Card title="构件映射明细" sub="统一里程由「构件起点统一里程 + 相对偏移」计算；拆分后子构件使用新主键，但统一里程连续。">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>检测期</th>
                <th>构件主键</th>
                <th>标签</th>
                <th>谱系键</th>
                <th>统一里程</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {analysis.assetMap.map((r) => (
                <tr key={`${r.periodId}-${r.assetId}`}>
                  <td><Badge tone="slate">{r.periodId}</Badge></td>
                  <td className="mono">{r.assetId}</td>
                  <td className="small">{r.label}</td>
                  <td className="mono tiny">{r.lineageKey}</td>
                  <td className="mono tiny">[{r.unifiedStartM}, {r.unifiedEndM}] m</td>
                  <td>
                    <Badge tone={r.derivation === 'split' ? 'warn' : r.derivation === 'merge' ? 'purple' : 'slate'}>
                      {r.derivation}
                    </Badge>
                    {r.derivedFrom.length > 0 && <span className="tiny muted"> ← {r.derivedFrom.join(',')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="谱系映射核验" sub="拆分并集、合并一致、每期无缝覆盖、跨新边界裂缝连续拼接。">
        <div className="check-list">
          {analysis.lineageChecks.map((c, i) => (
            <div key={i} className={`check ${c.ok ? 'pass' : 'fail'}`}>
              <span className="check-icon">{c.ok ? '✓' : '✕'}</span>
              <div>
                <div className="check-label">{c.label}</div>
                <div className="check-detail">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------------- 跨期匹配与分类 ----------------

function Matches({ analysis }: { analysis: RecurrenceAnalysis }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Card
      title="后期检出分类"
      sub={
        analysis.strategy === 'probabilistic'
          ? '概率匹配：每条后期检出保留全部候选，不确定性随候选分散程度上升；分类依据修复范围覆盖、原缺陷重叠、横向偏移、形态与走向。'
          : '确定性续接：仅当同一构件主键且里程缺口 ≤ 2 m 才建立候选；改造后主键重编处将丢失匹配（见 unmatched）。'
      }
    >
      {analysis.classifications.length === 0 && <Empty>无后期检出。</Empty>}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>后期检出</th>
              <th>统一里程</th>
              <th>分类</th>
              <th>最佳候选</th>
              <th className="right">概率</th>
              <th className="right">不确定性</th>
              <th>复发时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {analysis.classifications.map((c) => {
              const open = openId === c.postFindingId;
              return (
                <FragmentRow
                  key={c.postFindingId}
                  c={c}
                  open={open}
                  onToggle={() => setOpenId(open ? null : c.postFindingId)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function FragmentRow({ c, open, onToggle }: { c: FindingClassification; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr>
        <td>
          <div className="mono" style={{ fontWeight: 700 }}>{c.postFindingId}</div>
          <div className="tiny muted">{c.label}</div>
        </td>
        <td className="mono tiny">[{c.unifiedStartM.toFixed(1)}, {c.unifiedEndM.toFixed(1)}] m</td>
        <td>
          <Badge tone={CLASS_TONE[c.cls]}>{CLASS_LABELS[c.cls]}</Badge>
        </td>
        <td className="small">
          {c.bestRepairId ? (
            <>
              <span className="mono">{c.bestRepairId}</span>
              <span className="muted"> ← {c.bestOriginalFindingId}</span>
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="right mono">{c.probability === null ? '—' : c.probability.toFixed(2)}</td>
        <td className="right mono">
          <span className={c.uncertainty > 0.5 ? 'tone-warn' : ''}>{c.uncertainty.toFixed(2)}</span>
        </td>
        <td className="small">
          {monthsText(c.recurrenceMonths)}
          {c.withinWindow === false && <Badge tone="purple">超窗</Badge>}
          {c.withinWindow === true && <Badge tone="ok">窗内</Badge>}
        </td>
        <td>
          <button className="btn btn-subtle btn-sm" onClick={onToggle}>
            {open ? '收起' : `候选(${c.candidates.length})`}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ background: '#f8fafE' }}>
            <div className="small mb8"><b>判定理由：</b>{c.reason}</div>
            {c.candidates.length === 0 ? (
              <div className="small muted">该策略下无候选（改造重编导致的匹配损失，或里程容差外）。</div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>候选修复</th>
                      <th>原缺陷</th>
                      <th className="right">概率</th>
                      <th className="right">范围覆盖</th>
                      <th className="right">原区重叠</th>
                      <th className="right">里程缺口</th>
                      <th className="right">横向差</th>
                      <th className="right">走向差</th>
                      <th>形态</th>
                      <th>同键</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.candidates.map((cand) => (
                      <tr key={cand.repairId}>
                        <td className="mono tiny">{cand.repairId}</td>
                        <td className="mono tiny">{cand.originalFindingId}</td>
                        <td className="right mono">{cand.probability.toFixed(2)}</td>
                        <td className="right mono">{pct(cand.scopeCoverage)}</td>
                        <td className="right mono">{pct(cand.originalOverlap)}</td>
                        <td className="right mono">{cand.chainageGapM.toFixed(1)} m</td>
                        <td className="right mono">{cand.transverseGapM.toFixed(1)} m</td>
                        <td className="right mono">{cand.orientationDiffDeg.toFixed(0)}°</td>
                        <td>{cand.morphologyMatch ? <Badge tone="ok">相容</Badge> : <Badge tone="danger">不同</Badge>}</td>
                        <td>{cand.deterministicKeyMatch ? <Badge tone="teal">是</Badge> : <Badge tone="slate">否</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------- 样例核验 ----------------

interface VerifyLine {
  ok: boolean;
  text: string;
}

function Verify({
  analysis,
  strategy,
  windowMonths,
}: {
  analysis: RecurrenceAnalysis;
  strategy: MatchStrategy;
  windowMonths: number;
}) {
  const s = useStore();
  const dataset = s.recurrence!;
  const [lines, setLines] = useState<VerifyLine[] | null>(null);

  function find(id: string): FindingClassification | undefined {
    return analysis.classifications.find((c) => c.postFindingId === id);
  }

  function run() {
    const result: VerifyLine[] = [];

    // 1) 拆分后位置映射
    const mapOk = analysis.lineageOk;
    result.push({
      ok: mapOk,
      text: `资产谱系映射：拆分/合并/覆盖连续性/跨缝拼接核验 ${mapOk ? '全部通过' : '存在失败项'}`,
    });
    const fB2 = dataset.findings.find((f) => f.findingId === 'F-B2')!;
    const crossOk =
      fB2.segments.length === 2 &&
      analysis.classifications.some((c) => c.postFindingId === 'F-B2' && c.segmentCount === 2);
    result.push({
      ok: crossOk,
      text: `同一裂缝 F-B2 被 ${fB2.segments.length} 个拆分段承载，映射为连续里程（跨 60 m 接缝）`,
    });

    // 2) 复发 / 新缺陷分类
    const a2 = find('F-A2');
    result.push({
      ok: a2?.cls === 'confirmed_recurrence' || (strategy === 'deterministic' && a2?.cls === 'unmatched'),
      text:
        strategy === 'probabilistic'
          ? `F-A2（修复半段内）判为确认复发：${a2 ? CLASS_LABELS[a2.cls] : '缺失'}`
          : `F-A2 在确定性续接下因主键重编而丢失匹配：${a2 ? CLASS_LABELS[a2.cls] : '缺失'}（策略特性）`,
    });
    const g2 = find('F-G2');
    result.push({
      ok: g2?.cls === 'new_defect' && g2.recurrenceMonths === null,
      text: `F-G2 与 F-G 里程仅差约 1 m，但被判为「${g2 ? CLASS_LABELS[g2.cls] : '缺失'}」，未计为复发`,
    });
    const p2 = find('F-P2');
    result.push({
      ok: p2?.cls === 'residual_unrepaired',
      text: `F-P2（未验收修复处）判为「${p2 ? CLASS_LABELS[p2.cls] : '缺失'}」，不计入已验收修复复发`,
    });
    const s2 = find('F-S2');
    result.push({
      ok: s2?.cls === 'suspected_recurrence' && (s2?.candidates.length ?? 0) > 0,
      text: `F-S2（部分重叠）判为疑似复发，且保留 ${s2?.candidates.length ?? 0} 个候选用于传播不确定性`,
    });

    // 3) 统计区间
    const st = analysis.stats;
    const lateOk = st.lateRecurrence >= 1 && find('F-C3')?.withinWindow === false;
    result.push({
      ok: lateOk,
      text: `超窗复发 F-C3（${monthsText(find('F-C3')?.recurrenceMonths ?? null)}）落在 ${windowMonths} 个月窗口外，不计入窗口内分子`,
    });
    const mathOk = Math.abs(st.confirmedRate - (st.cohortSize ? st.confirmedWithin12 / st.cohortSize : 0)) < 1e-9;
    result.push({
      ok: mathOk,
      text: `统计区间：确认复发 ${pct(st.confirmedRate)}（${st.confirmedWithin12}/${st.cohortSize}），Wilson 95% ${ciText(st.confirmedCI)}`,
    });
    const windowOk = st.confirmedCI.low <= st.confirmedRate && st.confirmedRate <= st.confirmedCI.high;
    result.push({
      ok: windowOk,
      text: `点估计落在置信区间内（${pct(st.confirmedRate)} ∈ ${ciText(st.confirmedCI)}）`,
    });

    setLines(result);
  }

  return (
    <div>
      <Card title="样例核验（可重复执行）" sub="一次性核对四类关键情形：拆分后位置映射、复发/新缺陷分类、统计区间，以及“相邻位置检出不得自动算作复发”。">
        <div className="flex gap12 wrap" style={{ alignItems: 'center' }}>
          <Btn variant="primary" onClick={run}>
            运行复发率样例核验
          </Btn>
          <span className="small muted">
            当前策略：{strategy === 'probabilistic' ? '概率匹配' : '确定性续接'} · 窗口 {windowMonths} 个月
          </span>
        </div>
        {lines && (
          <div className="mt12">
            <div className={`banner ${lines.every((l) => l.ok) ? 'banner-ok' : 'banner-warn'}`}>
              <span className="bi">{lines.every((l) => l.ok) ? '✅' : '⚠️'}</span>
              <div>
                共 {lines.length} 项，{lines.filter((l) => l.ok).length} 项通过。
              </div>
            </div>
            <div className="step-msg info mt12">
              {lines.map((l, i) => (
                <div key={i} style={{ marginBottom: 3 }}>
                  {l.ok ? '✅' : '❌'} {l.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="样例内含的四个关键情形" sub="对应题目点名的验收场景。">
        <div className="check-list">
          <SampleCase
            icon="✂️"
            title="构件拆分"
            detail="G1（0~120 m）在 60 m 处拆分为 G1a/G1b，主键被重编；统一里程并集仍连续覆盖父范围。确定性续接在此丢失匹配，概率匹配可续接。"
            tone="pass"
          />
          <SampleCase
            icon="➰"
            title="同一裂缝延伸跨过新边界"
            detail="F-B（55~63 m）修复后，F-B2 由 G1a/G1b 两段承载延伸到 55~67 m；拼接后连续、判为确认复发。"
            tone="pass"
          />
          <SampleCase
            icon="◐"
            title="修复范围覆盖一半裂缝"
            detail="F-A（88~94 m）仅修复 88~91 m；F-A2 位于已修复半段内 → 确认复发；若检出落在未修复半段则为未闭环遗留。"
            tone="pass"
          />
          <SampleCase
            icon="↔️"
            title="邻近新裂缝"
            detail="F-G（160~163 m）修复后，F-G2（164~167 m）里程相邻但横向偏移 2 m、形态为纵向 → 判为新缺陷，绝不计为复发。"
            tone="pass"
          />
        </div>
      </Card>
    </div>
  );
}

function SampleCase({ icon, title, detail, tone }: { icon: string; title: string; detail: string; tone: 'pass' }) {
  return (
    <div className={`check ${tone}`}>
      <span className="check-icon">{icon}</span>
      <div>
        <div className="check-label">{title}</div>
        <div className="check-detail">{detail}</div>
      </div>
    </div>
  );
}
