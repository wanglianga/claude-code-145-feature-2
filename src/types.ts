// ===================== 基础类型 =====================

/** 告警类型 */
export type AlertType = 'fall' | 'heart_rate' | 'stillness' | 'away' | 'offline'

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  fall: '跌倒告警',
  heart_rate: '心率异常',
  stillness: '长时间静止',
  away: '离家未归',
  offline: '设备离线',
}

/** 事件状态机 */
export type EventStatus =
  | 'pending_family' // 待家属确认
  | 'family_verifying' // 电话核实中
  | 'door_visit' // 上门处置中
  | 'medical' // 就医中
  | 'follow_up' // 待回访结案
  | 'closed' // 已结案

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  pending_family: '待家属确认',
  family_verifying: '电话核实中',
  door_visit: '上门处置中',
  medical: '就医中',
  follow_up: '待回访结案',
  closed: '已结案',
}

export type Severity = 'high' | 'medium' | 'low'
export const SEVERITY_LABEL: Record<Severity, string> = {
  high: '紧急',
  medium: '重要',
  low: '一般',
}

/** 升级情形（触发即记录在事件内） */
export type EscalationKind =
  | 'family_timeout' // 家属迟迟未响应
  | 'phone_no_answer' // 老人电话无人接
  | 'low_battery' // 设备低电
  | 'low_battery_two_days' // 连续两天低电未充电
  | 'maintenance_delayed' // 低电期间离线，设备维护不及时
  | 'night_bathroom' // 夜间/浴室高风险场景
  | 'door_no_answer' // 网格员上门无人开门
  | 'need_property' // 需联动物业
  | 'need_120' // 需联动120

export const ESCALATION_LABEL: Record<EscalationKind, string> = {
  family_timeout: '家属超时未响应',
  phone_no_answer: '老人电话无人接听',
  low_battery: '设备电量过低',
  low_battery_two_days: '连续两天低电未充电',
  maintenance_delayed: '低电期间设备离线（维护不及时）',
  night_bathroom: '夜间/浴室高风险场景',
  door_no_answer: '上门无人开门',
  need_property: '需联动物业开门',
  need_120: '需联动120急救',
}

// ===================== 老人与设备 =====================

export interface EmergencyContact {
  name: string
  relation: string
  phone: string
  isLocal: boolean // 是否同城
  priority: number // 通知顺序
}

/** 告警阈值（绑定手环时设定，可调整） */
export interface Thresholds {
  heartRateLow: number // 心率下限 bpm
  heartRateHigh: number // 心率上限 bpm
  stillnessMinutes: number // 静止时长阈值（分钟）
  geofenceRadius: number // 电子围栏半径（米）
  curfewTime: string // 归家时间 HH:mm
}

export interface TrajectoryPoint {
  at: number
  place: string
}

export interface Elder {
  id: string
  name: string
  age: number
  gender: string
  phone: string
  address: string
  building: string // 楼栋，用于匹配网格员
  chronicDiseases: string[] // 慢病
  contacts: EmergencyContact[] // 紧急联系人
  activityRange: string[] // 常用活动范围
  wearingHabit: string // 佩戴习惯
  deviceId: string
  battery: number // 设备电量 %
  thresholds: Thresholds
  accessInfo: string // 门禁信息
  keyCustody: string // 钥匙托管
  historyFalseAlarms: number // 历史误报次数
  lastVisit: { at: number; worker: string; note: string } // 上一次回访记录
  trajectory: TrajectoryPoint[] // 最近活动轨迹
}

// ===================== 设备低电照护 =====================

/** 低电照护工单状态 */
export type BatteryCareStatus =
  | 'monitoring' // 低电观察中（首日低电，已推送提醒）
  | 'visit_suggested' // 连续两天未充电，建议家属/社区上门
  | 'family_reminded' // 家属确认已提醒老人
  | 'volunteer_assigned' // 已安排志愿者上门协助
  | 'resolved' // 已完成充电/处置
  | 'replacement' // 已决定更换设备或充电底座

export const BATTERY_CARE_STATUS_LABEL: Record<BatteryCareStatus, string> = {
  monitoring: '低电观察中',
  visit_suggested: '建议上门检查',
  family_reminded: '家属已提醒',
  volunteer_assigned: '志愿者已安排',
  resolved: '已完成充电',
  replacement: '更换设备/底座',
}

export interface BatterySample {
  at: number
  battery: number
  source: 'device' | 'manual' // 设备自动上报 / 社区手动模拟
}

/** 充电提醒/确认记录 */
export interface ChargingReminder {
  at: number
  by: string // 操作人
  role: 'family' | 'community' | 'system' | 'volunteer'
  kind: 'auto_notice' | 'family_reminded' | 'community_notice' | 'volunteer_assist'
  note?: string
}

/** 志愿者上门充电协助记录 */
export interface ChargeAssist {
  volunteerName: string
  volunteerPhone: string
  assignedAt: number
  arrivedAt?: number
  /** 处置结果 */
  result?: 'charged' | 'elder_refused' | 'device_fault' | 'dock_fault'
  note?: string
}

/**
 * 设备低电照护工单：手环连续低电未充电的完整跟踪
 * 一条进行中的工单对应一位老人；完成后保留在 history 中
 */
export interface BatteryCareEpisode {
  id: string
  elderId: string
  deviceId: string
  startedAt: number // 首次低电时间
  lowDays: number // 连续低电天数（跨天计数）
  lastDayKey: string // 已计数到的日期（YYYY-MM-DD），避免重复计天
  samples: BatterySample[] // 电量上报记录
  reminders: ChargingReminder[] // 提醒记录
  familyRemindedAt?: number // 家属确认已提醒老人的时间
  familyStillNotCharging?: boolean // 家属提醒后仍未充电
  chargeAssist?: ChargeAssist // 志愿者协助
  offlineAlertIds: string[] // 低电期间发生的离线告警
  status: BatteryCareStatus
  /** 工单结论（低电处理完成时填写） */
  resolution?: {
    at: number
    helperName: string // 充电协助人
    helperRole: 'family' | 'community' | 'volunteer' | 'elder_self'
    recoveredAt: number // 设备恢复（电量回到阈值以上）时间
    batteryAfter: number
    note: string
  }
  /** 再次低电时的更换决定 */
  replacement?: {
    at: number
    decidedBy: string
    option: 'device' | 'dock' | 'keep' // 更换手环 / 更换充电底座 / 暂不更换加强提醒
    reason: string
    relatedEpisodeId?: string // 关联的上一次低电工单
  }
  closedAt?: number
}

// ===================== 处置流程 =====================

export type PlanStepKey =
  | 'notify_family'
  | 'family_confirm'
  | 'phone_verify'
  | 'door_visit'
  | 'link_property'
  | 'call_120'
  | 'medical_follow'
  | 'device_maintain'
  | 'follow_up_close'

export interface PlanStep {
  key: PlanStepKey
  title: string
  desc: string
  reason: string // 生成该步骤的依据
  conditional: boolean // 是否条件触发
}

export type StepState = 'done' | 'active' | 'pending' | 'skipped'

// ===================== 事件 =====================

export interface TimelineEntry {
  at: number
  actor: 'device' | 'system' | 'family' | 'community' | 'medical' | 'volunteer'
  kind: 'alert' | 'confirm' | 'visit' | 'handle' | 'medical' | 'followup' | 'escalation' | 'close' | 'battery'
  title: string
  detail?: string
}

export interface PhoneAttempt {
  at: number
  by: string
  result: 'answered' | 'no_answer'
  note?: string
}

export interface AlertEvent {
  id: string
  elderId: string
  type: AlertType
  severity: Severity
  location: string // 告警位置：家-浴室 / 家-客厅 / 社区花园 / —（离线）
  isNight: boolean
  occurredAt: number
  batteryAtAlert: number
  status: EventStatus
  plan: PlanStep[]
  escalations: { kind: EscalationKind; at: number; note: string }[]

  family: {
    contactName: string
    contactPhone: string
    notifiedAt: number
    respondedAt?: number
    response?: 'false_alarm' | 'request_call' | 'request_visit' | 'called_120'
    note?: string
    timedOut: boolean
  }
  phoneAttempts: PhoneAttempt[]
  doorVisit?: {
    dispatchedAt: number
    assignee: string
    arrivedAt?: number
    result?: 'ok' | 'no_answer' | 'need_medical'
    note?: string
    propertyInvolved: boolean
    usedKeyCustody: boolean
  }
  medical?: {
    called120: boolean
    at?: number
    hospital?: string
    outcome?: string
  }
  followUp?: { at: number; by: string; note: string }
  closure?: Closure
  /** 关联的低电照护工单（低电期间发生的离线告警等） */
  batteryEpisodeId?: string
  timeline: TimelineEntry[]
}

// ===================== 结案与复盘 =====================

export type ClosureCategory = 'device_false' | 'care_gap' | 'real_risk'
export const CLOSURE_LABEL: Record<ClosureCategory, string> = {
  device_false: '设备误报',
  care_gap: '照护缺口',
  real_risk: '真实风险',
}

export interface Closure {
  closedAt: number
  closedBy: string
  category: ClosureCategory
  falseReason?: string // 误报原因
  deviceSuggestion: string // 设备调整建议
  familyResponseMinutes: number | null // 家属响应时长（分钟）
  communityHandleMinutes: number // 社区处置时效（分钟）
  /** 事件复盘：设备维护是否及时（低电期间离线等情形需记录） */
  maintenanceReview?: {
    delayed: boolean
    detail: string
    episodeId?: string
  }
  summary: string
}

// ===================== 照护画像 =====================

export interface CareProfile {
  elderId: string
  falseAlarmCount: number // 设备误报
  careGapCount: number // 照护缺口
  realRiskCount: number // 真实风险
  familyTimeoutCount: number // 家属无人响应
  offlineCount: number // 设备频繁离线
  doorNoAnswerCount: number // 上门无人在家
  lowBatteryCount: number // 低电照护工单次数（连续低电未充电）
  maintenanceDelayedCount: number // 低电期间离线/维护不及时次数
  chargeAssistCount: number // 志愿者上门协助充电次数
  riskLevel: 'high' | 'medium' | 'low'
  riskTags: string[] // 画像标签
  strategy: {
    visitFrequency: string // 巡访频次
    deviceMaintenance: string // 设备维护
    familyReminder: string // 家属提醒方式
  }
  updatedAt: number
}

// ===================== 人员 =====================

export interface GridWorker {
  id: string
  name: string
  phone: string
  buildings: string[] // 负责楼栋
  distanceMin: number // 预计到达分钟
}

/** 充电协助志愿者（社区互助名单） */
export interface Volunteer {
  id: string
  name: string
  phone: string
  buildings: string[] // 可服务楼栋
  distanceMin: number // 预计到达分钟
  available: boolean // 当前是否可接单
}

export interface DutyStaff {
  role: string
  name: string
  phone: string
}

export type Role = 'community' | 'family'

export interface Session {
  role: Role
  userName: string
  elderId?: string // 家属账号绑定的老人
}
