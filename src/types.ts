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
  | 'night_bathroom' // 夜间/浴室高风险场景
  | 'door_no_answer' // 网格员上门无人开门
  | 'need_property' // 需联动物业
  | 'need_120' // 需联动120
  | 'battery_unmaintained' // 低电维护不及时

export const ESCALATION_LABEL: Record<EscalationKind, string> = {
  family_timeout: '家属超时未响应',
  phone_no_answer: '老人电话无人接听',
  low_battery: '设备电量过低',
  night_bathroom: '夜间/浴室高风险场景',
  door_no_answer: '上门无人开门',
  need_property: '需联动物业开门',
  need_120: '需联动120急救',
  battery_unmaintained: '低电设备维护不及时',
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
  lowBatterySince?: number // 最近一次进入低电（≤20%）的时间；充电恢复后清空
  lastChargedAt?: number // 最近一次充电恢复时间
  thresholds: Thresholds
  accessInfo: string // 门禁信息
  keyCustody: string // 钥匙托管
  historyFalseAlarms: number // 历史误报次数
  lastVisit: { at: number; worker: string; note: string } // 上一次回访记录
  trajectory: TrajectoryPoint[] // 最近活动轨迹
}

// ===================== 低电照护任务 =====================

export type BatteryTaskStatus =
  | 'reminding' // 低电满2天：已提示家属/社区，等待家属确认
  | 'family_reminded' // 家属确认已提醒，等待老人充电
  | 'volunteer_dispatched' // 家属确认提醒无效：志愿者已安排
  | 'volunteer_arrived' // 志愿者已上门
  | 'resolved' // 已恢复充电
  | 'replaced' // 已更换设备/充电底座

export const BATTERY_TASK_STATUS_LABEL: Record<BatteryTaskStatus, string> = {
  reminding: '待家属确认',
  family_reminded: '家属已提醒·待充电',
  volunteer_dispatched: '志愿者已安排',
  volunteer_arrived: '志愿者已上门',
  resolved: '已恢复充电',
  replaced: '已更换设备',
}

/** 低电照护协助记录（家属提醒 / 志愿者上门协助 / 更换设备） */
export interface BatteryCareRecord {
  at: number
  by: string
  action: 'detect' | 'family_reminded' | 'volunteer_dispatch' | 'volunteer_arrive' | 'charge_assist' | 'replace_device' | 'family_dismiss'
  note?: string
}

/** 设备连续低电导致的照护风险任务 */
export interface BatteryCareTask {
  id: string
  elderId: string
  deviceId: string
  lowSince: number // 连续低电起始时间
  detectedAt: number // 系统识别“连续两天低电”的时间
  battery: number
  status: BatteryTaskStatus
  familyRemindedAt?: number // 家属确认已提醒老人充电的时间
  familyReminderName?: string
  familyNote?: string
  volunteerId?: string
  volunteerName?: string
  volunteerPhone?: string
  dispatchedAt?: number
  arrivedAt?: number
  /** 低电处理完成：充电协助人 */
  chargeAssistedBy?: string
  /** 低电处理完成：充电恢复时间 */
  resolvedAt?: number
  /** 反复低电后系统是否已提示更换设备/充电底座 */
  replacementPrompted?: boolean
  /** 是否已登记更换设备/充电底座的处置决定 */
  replacementDecided?: boolean
  replacementKind?: 'device' | 'charger' | null
  replacementNote?: string
  /** 第几次连续低电（1=首次，≥2 提示更换设备或底座） */
  repeatIndex: number
  riskTips: string[] // 根据佩戴习惯与历史告警生成的上门检查提示
  records: BatteryCareRecord[]
}

/** 协助充电/上门检查的志愿者 */
export interface Volunteer {
  id: string
  name: string
  phone: string
  buildings: string[] // 就近负责楼栋
  distanceMin: number
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
  | 'battery_care'
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
  actor: 'device' | 'system' | 'family' | 'community' | 'medical'
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
  /** 关联的连续低电照护任务（低电期间发生离线告警时写入，供事件复盘引用） */
  batteryCareTaskId?: string
  /** 设备维护不及时的复盘说明（低电期间发生离线告警时自动生成） */
  batteryCareNote?: string
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
  /** 事件复盘的设备维护部分：低电期间离线时记录“设备维护不及时” */
  deviceMaintenanceNote?: string
  familyResponseMinutes: number | null // 家属响应时长（分钟）
  communityHandleMinutes: number // 社区处置时效（分钟）
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
  lowBatteryCount: number // 连续低电未充电（设备维护照护风险）
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
