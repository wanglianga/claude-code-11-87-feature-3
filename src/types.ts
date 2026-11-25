// ============================================================
// 交付契约平台 · 共享领域类型
// 所有跨层（领域逻辑 / Worker / IndexedDB / UI）结构均定义于此
// ============================================================

export type Role = 'builder' | 'supervisor' | 'auditor' | 'admin';

export type Purpose = 'deliver' | 'review' | 'audit';

/** 字段组：授权交集的“字段组”维度 */
export type FieldGroup =
  | 'identity' // 报告号 / 修订号 / 缺陷ID
  | 'location' // 标段 / 坐标
  | 'measurement' // 裂缝宽度 / 检测方法
  | 'workflow' // 整改状态 / 核验时间
  | 'media' // 影像原件引用
  | 'attachmentIndex' // 经授权的附件索引
  | 'assurance'; // 哈希 / 签名 / 修订链

export type FieldValueType =
  | 'string'
  | 'integer'
  | 'decimal'
  | 'datetime'
  | 'enum'
  | 'coordinate'
  | 'attachmentRefs'
  | 'hash'
  | 'signature';

/** 字段契约：明确类型、单位、舍入精度、空值含义、枚举、来源与可见角色 */
export interface FieldContract {
  key: string;
  label: string;
  group: FieldGroup;
  valueType: FieldValueType;
  unit?: string;
  /** 保留小数位（舍入精度） */
  scale?: number;
  /** 仪器检出限；低于此值必须表达为“<检出限”，严禁舍入成 0 */
  detectionLimit?: number;
  /** 空值的业务含义（null 绝不等于 0 / 未整改） */
  nullMeaning: string;
  required: boolean;
  enumValues?: { value: string; label: string }[];
  /** 数据来源系统 / 责任方 */
  source: string;
  /** 契约层面允许可见的角色（最终还需与授权许可求交集） */
  visibleRoles: Role[];
  description?: string;
}

// ---------------- 源数据 ----------------

export interface Coordinate {
  /** 地方工程坐标系 X（米，源数据保留 3 位小数） */
  x: number;
  y: number;
}

export type RectificationStatus = 'open' | 'in_progress' | 'rectified' | 'verified';

export type DetectionMethod = 'visual' | 'crack_gauge' | 'ultrasonic' | 'ground_penetrating_radar';

export interface Defect {
  defectId: string;
  projectId: string;
  sectionId: string;
  coordinate: Coordinate | null;
  /** 裂缝宽度原始读数（毫米，可能低于检出限；null 表示未测量） */
  crackWidthMm: number | null;
  detectionMethod: DetectionMethod | null;
  imageSummary: string | null;
  rectificationStatus: RectificationStatus | null;
  verifiedAt: string | null;
  attachmentIds: string[];
}

export interface Attachment {
  attachmentId: string;
  projectId: string;
  sectionId: string;
  defectId: string | null;
  filename: string;
  kind: 'photo' | 'reading' | 'certificate' | 'internal';
  contentType: string;
  /** 演示环境中以内联 SVG 文本作为“附件原件” */
  contentText: string;
  sha256: string;
  bytes: number;
  /** 是否可进入监理的授权附件索引 */
  supervisorIndexable: boolean;
}

export interface ReportRevision {
  reportNo: string;
  revision: number;
  projectId: string;
  title: string;
  publishedAt: string;
  /** 本修订相对上一修订的变更说明 */
  changeNote: string;
  /** 本修订发生变化的缺陷字段（用于重审标记与差异展示） */
  changes: { defectId: string; field: string; before: unknown; after: unknown }[];
  defects: Defect[];
  /** 对该修订规范化内容计算出的报告哈希 */
  reportHash: string;
  signedBy: string;
  signature: string;
  signedAt: string;
}

export interface Report {
  reportNo: string;
  projectId: string;
  currentRevision: number;
  revisions: ReportRevision[];
}

export interface Project {
  projectId: string;
  name: string;
  sections: { sectionId: string; name: string }[];
}

export interface Account {
  accountId: string;
  username: string;
  password: string;
  displayName: string;
  role: Role;
  org: string;
  /** 施工方账号所属标段；监理/审计为跨标段授权，用许可表达 */
  sectionIds?: string[];
}

// ---------------- 授权 ----------------

export interface Authorization {
  licenseId: string;
  /** 许可版本：换发/变更字段组时递增，物化包固定此版本 */
  licenseVersion: number;
  accountId: string;
  role: Role;
  projectId: string;
  /** 授权标段；['*'] 表示项目内全部标段 */
  sectionIds: string[];
  fieldGroups: FieldGroup[];
  purposes: Purpose[];
  validFrom: string;
  validUntil: string;
  status: 'active' | 'revoked';
  issuedAt: string;
  revokedAt?: string;
  revokeReason?: string;
}

/** 六维交集的逐维结论 */
export interface AuthDimensionTrace {
  dimension: 'project' | 'section' | 'role' | 'fieldGroup' | 'purpose' | 'validity';
  label: string;
  required: string;
  granted: string;
  passed: boolean;
}

// ---------------- 投影编译器 ----------------

export type DecisionOutcome = 'included' | 'excluded' | 'transformed';

export type ReasonCode =
  | 'included'
  | 'contract_role_denied'
  | 'project_not_authorized'
  | 'section_not_authorized'
  | 'role_license_mismatch'
  | 'field_group_not_licensed'
  | 'purpose_not_licensed'
  | 'license_revoked'
  | 'license_expired'
  | 'license_not_yet_valid'
  | 'below_detection_limit'
  | 'rounded_to_contract_scale'
  | 'coordinate_precision_applied'
  | 'null_meaning_preserved'
  | 'attachment_unauthorized_section'
  | 'attachment_not_in_authorized_index'
  | 'source_revision_pinned';

export interface FieldReason {
  code: ReasonCode;
  message: string;
}

export interface FieldDecision {
  uid: string;
  entityType: 'report' | 'defect' | 'attachment';
  entityId: string;
  fieldKey: string;
  fieldLabel: string;
  outcome: DecisionOutcome;
  reasons: FieldReason[];
}

export interface ProjectedField<T = unknown> {
  value: T;
  /** 展示文本（含单位 / 检出限表达 / 空值语义） */
  display: string;
  unit?: string;
  decision: FieldDecision;
}

export interface ProjectedDefect {
  defectId: string;
  sectionId?: ProjectedField<string>;
  coordinate?: ProjectedField<{ x: string; y: string }>;
  crackWidth?: ProjectedField<string | number | null> & { belowDetectionLimit?: boolean };
  detectionMethod?: ProjectedField<string>;
  imageSummary?: ProjectedField<string>;
  rectificationStatus?: ProjectedField<string>;
  verifiedAt?: ProjectedField<string>;
  attachments?: ProjectedField<ProjectedAttachmentRef[]>;
}

export interface ProjectedAttachmentRef {
  attachmentId: string;
  filename: string;
  kind: Attachment['kind'];
  sha256: string;
  bytes: number;
  indexOnly: boolean;
}

export interface Projection {
  projectionId: string;
  generatedAt: string;
  mode: 'dynamic' | 'materialized';
  projectId: string;
  reportNo: string;
  revision: number;
  receiverAccountId: string;
  receiverRole: Role;
  purpose: Purpose;
  /** 授权快照（固定许可版本）；无有效许可时为 null */
  licenseSnapshot: Pick<
    Authorization,
    'licenseId' | 'licenseVersion' | 'fieldGroups' | 'sectionIds' | 'purposes'
  > | null;
  contractVersion: string;
  sourceReportHash: string;
  reportHeader: Record<string, ProjectedField>;
  defects: ProjectedDefect[];
  attachmentIndex: ProjectedAttachmentRef[];
  assurance?: {
    reportHash: string;
    signature: string;
    signedBy: string;
    signedAt: string;
    revisionChain: { revision: number; reportHash: string; signedAt: string; changeNote: string }[];
  };
  decisions: FieldDecision[];
  authTrace: AuthDimensionTrace[];
  /** 整体拒绝原因（如项目级无授权 / 许可撤销） */
  deniedReason?: FieldReason;
}

// ---------------- 交付包与校验 ----------------

export interface ValidationCheck {
  id: 'required-fields' | 'units' | 'signature' | 'attachment-refs' | 'report-hash' | 'auth-version';
  label: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

export interface ValidationReport {
  valid: boolean;
  checks: ValidationCheck[];
  validatedAt: string;
}

export type PackageStatus = 'available' | 'release_blocked' | 'superseded';

export interface PackagePins {
  contractVersion: string;
  licenseId: string;
  licenseVersionAtMaterialize: number;
  reportNo: string;
  revision: number;
  sourceReportHash: string;
}

export interface DeliveryPackage {
  packageId: string;
  kind: 'materialized' | 'dynamic';
  projectId: string;
  reportNo: string;
  revision: number;
  receiverAccountId: string;
  receiverName: string;
  receiverRole: Role;
  purpose: Purpose;
  pins: PackagePins;
  projection: Projection;
  manifest: {
    requiredPaths: string[];
    units: Record<string, string>;
    files: { path: string; sha256: string; bytes: number }[];
  };
  reportHash: string;
  signer: string;
  algorithm: 'HMAC-SHA256-DEMO';
  signature: string;
  status: PackageStatus;
  createdAt: string;
  downloadCount: number;
  lastReleaseAt?: string;
  /** 演示“传输中/存储后被篡改”开关：为 true 时 payload 与签名不一致 */
  tampered: boolean;
  auditEventIds: string[];
}

// ---------------- 回执账 ----------------

export type ReceiptType =
  | 'transmit_received'
  | 'structure_parsed'
  | 'semantic_confirmed'
  | 'questioned'
  | 'corrected';

export interface Receipt {
  receiptId: string;
  /** 同一接收方 + 报告修订构成一本语义账 */
  ledgerKey: string;
  projectId: string;
  reportNo: string;
  revision: number;
  receiverAccountId: string;
  receiverName: string;
  receiverRole: Role;
  type: ReceiptType;
  at: string;
  note?: string;
  packageId?: string;
  /** corrected 类型：指向被更正的旧修订 / 回执 */
  correctsRevision?: number;
  correctsReceiptId?: string;
  /** 传输回执等机器来源标记 */
  source: 'receiver' | 'gateway' | 'platform';
}

export type LedgerState =
  | 'none'
  | 'transmit_received'
  | 'structure_parsed'
  | 'semantic_confirmed'
  | 'questioned'
  | 'conflict'
  | 'adjudicated_confirm'
  | 'adjudicated_question'
  | 'corrected';

export interface Adjudication {
  adjudicationId: string;
  ledgerKey: string;
  at: string;
  adminAccountId: string;
  outcome: 'uphold_confirmation' | 'uphold_question';
  rationale: string;
}

// ---------------- 离线审阅意见 ----------------

export type CommentSyncState = 'local-only' | 'pending' | 'synced' | 'merge-conflict';

export interface ReviewComment {
  /** 意见ID：离线创建即生成，恢复联网后按此 ID 合并 */
  commentId: string;
  projectId: string;
  reportNo: string;
  defectId: string;
  body: string;
  authorAccountId: string;
  authorName: string;
  /** 基线版本：离线意见必须绑定某个报告修订与哈希 */
  baseline: {
    reportNo: string;
    revision: number;
    reportHash: string;
    packageId?: string;
  };
  createdAt: string;
  updatedAt: string;
  syncState: CommentSyncState;
  /** 服务端已存在同 ID 且更新时，保存服务端文本供冲突裁定 */
  serverBody?: string;
  serverUpdatedAt?: string;
  /** 合并后计算：基线之后相关字段发生变化，需对新修订重审 */
  needsReReviewFor?: number;
  changedFields?: string[];
}

export interface ReceiptDraft {
  draftId: string;
  ledgerKey: string;
  projectId: string;
  reportNo: string;
  revision: number;
  receiverAccountId: string;
  type: ReceiptType;
  note?: string;
  createdAt: string;
  syncState: 'local-only' | 'pending';
}

// ---------------- 审计 ----------------

export type AuditEventType =
  | 'package_materialized'
  | 'package_released'
  | 'package_release_blocked'
  | 'package_rebuilt'
  | 'dynamic_projection_generated'
  | 'validation_failed'
  | 'license_revoked'
  | 'license_renewed'
  | 'revision_published'
  | 'comments_merged'
  | 'receipt_registered'
  | 'conflict_adjudicated'
  | 'offline_edit_blocked';

export interface AuditEvent {
  eventId: string;
  at: string;
  type: AuditEventType;
  actorAccountId: string;
  actorName: string;
  summary: string;
  detail?: Record<string, unknown>;
  /** 已签署交付的审计摘要在任何授权变更后都保留 */
  signedDeliverySummary?: {
    packageId: string;
    reportHash: string;
    signature: string;
    receiverAccountId: string;
    revision: number;
  };
}

// ---------------- 缺陷复发率数据集 ----------------
//
// 目标：同一修复位置下一轮仍检出裂缝，可能是①原缺陷未修复、②修复后复发、
// ③施工接缝附近的新缺陷。必须先把不同期间的构件（管段/盖梁等）谱系映射到
// 统一的局部里程（米），再用「修复账」的施工范围/材料/完成时点/验收证据，
// 把前后两期检测的区间位置、形态与修复范围组成候选，分别统计确认复发、
// 疑似复发与新缺陷，并给出 12 个月复发比例及其统计区间。

/** 构件/管段类型 */
export type AssetKind = 'box_girder' | 'pier_cap' | 'deck_slab' | 'pipe_segment' | 'wall';

/** 资产谱系节点：某检测期内一个构件，带统一局部里程区间（米） */
export interface AssetNode {
  /** 期内构件主键；改造后可能被重编（如拆分/合并产生新主键） */
  assetId: string;
  periodId: string;
  label: string;
  kind: AssetKind;
  /** 谱系稳定键：同一结构体经拆分/合并后仍可追溯到同一谱系 */
  lineageKey: string;
  /** 统一局部里程（米），沿结构纵向，跨期连续可比 */
  unifiedStartM: number;
  unifiedEndM: number;
  /** 拆分/合并来源的父构件主键；original/retained 可为空数组或自引用 */
  derivedFrom: string[];
  derivation: 'original' | 'retained' | 'split' | 'merge';
}

export interface InspectionPeriod {
  periodId: string;
  label: string;
  inspectedAt: string;
  note?: string;
}

/** 裂缝在某一构件上的区段（构件被拆分后，一条裂缝可横跨多个构件） */
export interface FindingSegment {
  assetId: string;
  /** 相对该构件起点的纵向偏移（米） */
  fromOffsetM: number;
  toOffsetM: number;
}

export type CrackMorphology = 'diagonal' | 'transverse' | 'longitudinal' | 'map_crack' | 'joint';

/** 一次检测的一条逻辑裂缝（可含跨多个构件的区段） */
export interface InspectionFinding {
  findingId: string;
  periodId: string;
  label: string;
  morphology: CrackMorphology;
  /** 裂缝走向（度，相对构件纵轴 0°=纵向、90°=横向） */
  orientationDeg: number;
  /** 横向偏移（米，沿构件表面，用以区分“同里程但不同位置”的邻近裂缝） */
  transverseOffsetM: number;
  widthMm: number | null;
  lengthM: number;
  measuredAt: string;
  segments: FindingSegment[];
}

export type RepairStatus = 'accepted' | 'pending' | 'rejected';

export interface AcceptanceEvidence {
  evidenceId: string;
  kind: 'material_cert' | 'construction_record' | 'acceptance_photo' | 'third_party';
  label: string;
  /** 证据内容 SHA-256（演示环境由内容文本计算） */
  sha256Ref: string;
}

/** 修复账：一条针对某原缺陷的修复记录 */
export interface RepairRecord {
  repairId: string;
  /** 目标原缺陷 */
  findingId: string;
  /** 施工所属期（原缺陷所在检测期） */
  periodId: string;
  /** 施工范围（统一局部里程，米）；可能只覆盖原裂缝的一部分 */
  scope: { unifiedStartM: number; unifiedEndM: number };
  material: string;
  completedAt: string;
  /** 验收时点；null 表示尚未验收（不计入复发率分母） */
  acceptedAt: string | null;
  status: RepairStatus;
  acceptanceEvidence: AcceptanceEvidence[];
}

export interface RecurrenceDataset {
  projectId: string;
  structureLabel: string;
  /** 统计评估时点：判断随访是否满 12 个月 */
  evaluationAt: string;
  /** 复发观察窗口（月） */
  windowMonths: number;
  periods: InspectionPeriod[];
  assets: AssetNode[];
  findings: InspectionFinding[];
  repairs: RepairRecord[];
}

export type MatchStrategy = 'deterministic' | 'probabilistic';

export type RecurrenceClass =
  | 'confirmed_recurrence'
  | 'suspected_recurrence'
  | 'new_defect'
  | 'residual_unrepaired'
  | 'unmatched';

/** 一个候选匹配（确定性/概率匹配都会保留全部候选以传播不确定性） */
export interface FindingMatchCandidate {
  repairId: string;
  originalFindingId: string;
  /** 概率匹配得分（0..1），确定性匹配时仍计算以供复核 */
  probability: number;
  /** 构件主键 + 线性里程容差是否命中 */
  deterministicKeyMatch: boolean;
  chainageGapM: number;
  chainageOverlapM: number;
  /** 检出区段落在修复施工范围内的比例 */
  scopeCoverage: number;
  /** 检出区段与原缺陷区段的重叠比例 */
  originalOverlap: number;
  transverseGapM: number;
  orientationDiffDeg: number;
  morphologyMatch: boolean;
  appearedAfterAcceptance: boolean;
  /** 自验收到本次检出的月数 */
  recurrenceMonths: number | null;
  notes: string[];
}

export interface FindingClassification {
  postFindingId: string;
  label: string;
  periodId: string;
  unifiedStartM: number;
  unifiedEndM: number;
  segmentCount: number;
  strategy: MatchStrategy;
  bestRepairId: string | null;
  bestOriginalFindingId: string | null;
  cls: RecurrenceClass;
  probability: number | null;
  /** 匹配不确定性（0..1），候选越分散或概率越低越大 */
  uncertainty: number;
  /** 保留全部候选（含被否决的），供人工复核 */
  candidates: FindingMatchCandidate[];
  recurrenceMonths: number | null;
  withinWindow: boolean | null;
  reason: string;
}

export interface RecurrenceStat {
  cohortSize: number;
  confirmedWithin12: number;
  suspectedWithin12: number;
  newDefect: number;
  residual: number;
  none: number;
  lateRecurrence: number;
  matchedRepairs: number;
  confirmedRate: number;
  suspectedRate: number;
  combinedRate: number;
  confirmedCI: { low: number; high: number };
  suspectedCI: { low: number; high: number };
  combinedCI: { low: number; high: number };
  medianRecurrenceMonths: number | null;
  immature: number;
  pending: number;
  excludedNotAccepted: number;
}

export interface AssetMapRow {
  assetId: string;
  periodId: string;
  label: string;
  lineageKey: string;
  unifiedStartM: number;
  unifiedEndM: number;
  derivation: AssetNode['derivation'];
  derivedFrom: string[];
}

export interface LineageCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface RecurrenceAnalysis {
  strategy: MatchStrategy;
  assetMap: AssetMapRow[];
  lineageChecks: LineageCheck[];
  lineageOk: boolean;
  classifications: FindingClassification[];
  stats: RecurrenceStat;
}

// ---------------- 持久化根状态 ----------------

export interface ServerState {
  licenses: Authorization[];
  reports: Record<string, Report>; // key reportNo
  currentReportNo: string;
  adjudications: Adjudication[];
  /** 服务端意见（模拟“云端”，同步合并的对端） */
  serverComments: ReviewComment[];
}

export const CONTRACT_VERSION = 'fc-2026.1';
