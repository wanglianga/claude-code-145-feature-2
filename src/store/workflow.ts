import {
  AlertEvent,
  AlertType,
  ALERT_TYPE_LABEL,
  BatteryCareEpisode,
  CareProfile,
  Closure,
  ClosureCategory,
  Elder,
  GridWorker,
  PlanStep,
  Severity,
  StepState,
  Volunteer,
} from '../types'

// ===================== 演示参数 =====================
/** 家属响应超时（毫秒）。演示环境设为 3 分钟 */
export const FAMILY_TIMEOUT_MS = 3 * 60 * 1000
/** 电话核实无人接听达到该次数则建议上门 */
export const PHONE_NO_ANSWER_LIMIT = 2
/** 低电量阈值 */
export const LOW_BATTERY = 20
/** 连续低电达到该天数且未充电，提示家属/社区上门检查 */
export const LOW_BATTERY_DAYS = 2
/** 完成充电判定：电量回升至该值以上视为恢复 */
export const CHARGED_BATTERY = 50

export const isNightTime = (d: Date) => d.getHours() >= 22 || d.getHours() < 6

/** 日期键（YYYY-MM-DD），用于低电跨天计数 */
export const dayKey = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ===================== 严重度评估 =====================

export function assessSeverity(
  type: AlertType,
  opts: { isNight: boolean; location: string; battery: number; historyFalseAlarms: number },
): Severity {
  let score = 0
  if (type === 'fall') score += 3
  if (type === 'heart_rate') score += 3
  if (type === 'stillness') score += 2
  if (type === 'away') score += 1
  if (type === 'offline') score += 1
  if (opts.isNight) score += 2
  if (opts.location.includes('浴室')) score += 2
  if (opts.battery <= LOW_BATTERY) score += 1
  // 误报史多可适当降级，但夜间/浴室等高风险场景不降级
  const riskyScene = opts.isNight || opts.location.includes('浴室')
  if (opts.historyFalseAlarms >= 3 && !riskyScene) score -= 1
  if (score >= 5) return 'high'
  if (score >= 3) return 'medium'
  return 'low'
}

// ===================== 处置流程生成 =====================

export interface PlanContext {
  elder: Elder
  type: AlertType
  location: string
  isNight: boolean
  battery: number
  severity: Severity
  gridWorkers: GridWorker[]
  dutyText: string
}

/** 依据告警类型、最近轨迹、历史误报、家属联系方式、值班人员生成处置流程 */
export function generatePlan(ctx: PlanContext): PlanStep[] {
  const { elder, type, location, isNight, battery, severity, gridWorkers, dutyText } = ctx
  const steps: PlanStep[] = []
  const firstContact = [...elder.contacts].sort((a, b) => a.priority - b.priority)[0]
  const worker = nearestWorker(elder, gridWorkers)
  const highFalse = elder.historyFalseAlarms >= 3
  const riskyScene = isNight || location.includes('浴室')

  steps.push({
    key: 'notify_family',
    title: '通知紧急联系人',
    desc: `按优先级通知 ${firstContact.name}（${firstContact.relation}，${firstContact.phone}）${
      firstContact.isLocal ? '，同城可到场' : '，异地需远程确认'
    }`,
    reason: `老人登记 ${elder.contacts.length} 位紧急联系人，按优先级排序`,
    conditional: false,
  })

  steps.push({
    key: 'family_confirm',
    title: '等待家属确认',
    desc: `家属可确认误报 / 请求电话核实 / 要求上门 / 直接拨打120。超过 ${Math.round(
      FAMILY_TIMEOUT_MS / 60000,
    )} 分钟未响应将自动升级社区处置`,
    reason: '家属是第一响应人，限时未响应需社区接管',
    conditional: false,
  })

  // 电话核实：误报史多或中低等级先电话
  if (highFalse || severity !== 'high') {
    steps.push({
      key: 'phone_verify',
      title: '电话核实老人状态',
      desc: `值班人员拨打老人电话 ${elder.phone}，连续 ${PHONE_NO_ANSWER_LIMIT} 次无人接听即升级上门`,
      reason: highFalse
        ? `该老人历史误报 ${elder.historyFalseAlarms} 次，优先电话核实降低无效上门`
        : `告警等级为${severity === 'medium' ? '重要' : '一般'}，先电话核实`,
      conditional: false,
    })
  }

  const visitReasons: string[] = []
  if (type === 'fall') visitReasons.push('跌倒告警需现场确认伤情')
  if (type === 'heart_rate') visitReasons.push(`心率异常，老人有${elder.chronicDiseases.join('、') || '慢病'}史`)
  if (type === 'stillness') visitReasons.push(`静止超阈值 ${elder.thresholds.stillnessMinutes} 分钟`)
  if (type === 'away') visitReasons.push(`超出电子围栏 ${elder.thresholds.geofenceRadius} 米且过归家时间 ${elder.thresholds.curfewTime}`)
  if (type === 'offline') visitReasons.push('设备离线需上门核查人与设备状态')
  if (riskyScene) visitReasons.push(isNight ? '夜间时段风险升级' : '浴室属跌倒高风险场景')
  steps.push({
    key: 'door_visit',
    title: '网格员上门处置',
    desc: `就近派单 ${worker.name}（负责${worker.buildings.join('/')}，约 ${worker.distanceMin} 分钟到达）。门禁：${elder.accessInfo}；钥匙托管：${elder.keyCustody}`,
    reason: visitReasons.join('；'),
    conditional: severity === 'low' && !riskyScene,
  })

  steps.push({
    key: 'link_property',
    title: '联动物业开门',
    desc: '上门无人开门时，联系物业协助开门或使用托管钥匙入户查看',
    reason: '兜底情形：上门无人应答',
    conditional: true,
  })

  steps.push({
    key: 'call_120',
    title: '联动120急救',
    desc: `发现伤情或家属直接呼救时拨打120，同步老人慢病史（${elder.chronicDiseases.join('、') || '无'}）与用药信息`,
    reason: '兜底情形：现场确认需要医疗救援',
    conditional: true,
  })

  steps.push({
    key: 'medical_follow',
    title: '就医跟进',
    desc: '记录送医医院与诊断结果，通知家属赶往，更新事件状态',
    reason: '联动120后必须记录就医去向',
    conditional: true,
  })

  if (battery <= LOW_BATTERY || type === 'offline') {
    steps.push({
      key: 'device_maintain',
      title: '设备维护（低电照护）',
      desc: battery <= LOW_BATTERY
        ? `告警时电量仅 ${battery}%：推送家属充电提醒；若连续两天低电未充电，提示家属/社区上门检查；家属已提醒仍未充电可安排志愿者上门协助充电，完成后记录协助人与恢复时间`
        : '设备离线，安排上门核查人与设备状态，核对充电底座与佩戴习惯',
      reason: battery <= LOW_BATTERY ? '低电量影响告警可靠性，连续低电构成照护风险' : '离线告警指向设备/佩戴/供电问题',
      conditional: true,
    })
  }

  steps.push({
    key: 'follow_up_close',
    title: '回访与结案复盘',
    desc: `24小时内回访老人与家属，生成误报原因/设备建议/响应时长复盘，沉淀照护画像。今日值班：${dutyText}`,
    reason: '每次事件闭环后优化阈值与照护责任',
    conditional: false,
  })

  return steps
}

/** 根据事件当前状态推导各流程步骤状态 */
export function deriveStepStates(ev: AlertEvent): Record<string, StepState> {
  const s: Record<string, StepState> = {}
  const has = (k: string) => ev.plan.some((p) => p.key === k)

  s.notify_family = 'done'
  if (ev.family.respondedAt) s.family_confirm = 'done'
  else if (ev.status === 'pending_family') s.family_confirm = 'active'
  else s.family_confirm = ev.family.timedOut ? 'skipped' : 'pending'

  if (has('phone_verify')) {
    const answered = ev.phoneAttempts.some((a) => a.result === 'answered')
    if (answered || ev.status === 'door_visit' || ev.status === 'medical' || ev.status === 'follow_up' || ev.status === 'closed')
      s.phone_verify = answered ? 'done' : ev.phoneAttempts.length > 0 ? 'done' : 'skipped'
    else if (ev.status === 'family_verifying') s.phone_verify = 'active'
    else s.phone_verify = 'pending'
  }

  if (has('door_visit')) {
    if (ev.doorVisit?.result) s.door_visit = 'done'
    else if (ev.doorVisit) s.door_visit = 'active'
    else s.door_visit = 'pending'
  }
  if (has('link_property')) {
    s.link_property = ev.doorVisit?.propertyInvolved || ev.doorVisit?.usedKeyCustody ? 'done' : 'pending'
  }
  if (has('call_120')) {
    s.call_120 = ev.medical?.called120 ? 'done' : 'pending'
  }
  if (has('medical_follow')) {
    s.medical_follow = ev.medical?.outcome ? 'done' : ev.medical?.called120 ? 'active' : 'pending'
  }
  if (has('device_maintain')) {
    s.device_maintain = ev.status === 'closed' ? 'done' : 'pending'
  }
  if (has('follow_up_close')) {
    if (ev.status === 'closed') s.follow_up_close = 'done'
    else if (ev.status === 'follow_up') s.follow_up_close = 'active'
    else s.follow_up_close = 'pending'
  }
  return s
}

// ===================== 升级规则检查 =====================

export interface EscalationCheck {
  kind: AlertEvent['escalations'][number]['kind']
  note: string
}

/** 返回本次检查新触发的升级情形（已存在的不重复） */
export function checkEscalations(ev: AlertEvent, elder: Elder, now: number, episode?: BatteryCareEpisode): EscalationCheck[] {
  const out: EscalationCheck[] = []
  const has = (k: EscalationCheck['kind']) => ev.escalations.some((e) => e.kind === k)
  if (ev.status === 'closed') return out

  if (!has('night_bathroom') && (ev.isNight || ev.location.includes('浴室'))) {
    out.push({
      kind: 'night_bathroom',
      note: ev.isNight ? '告警发生在夜间（22:00-06:00），风险等级上调' : '告警发生在浴室，属跌倒高风险场景',
    })
  }
  if (!has('low_battery') && ev.batteryAtAlert <= LOW_BATTERY) {
    out.push({ kind: 'low_battery', note: `告警时设备电量仅 ${ev.batteryAtAlert}%，需同步安排设备维护` })
  }
  // 低电照护工单：连续两天低电未充电
  if (episode && episode.lowDays >= LOW_BATTERY_DAYS && !has('low_battery_two_days')) {
    out.push({
      kind: 'low_battery_two_days',
      note: `手环已连续 ${episode.lowDays} 天低电未充电，已提示家属/社区上门检查老人与设备`,
    })
  }
  // 低电期间发生离线告警：设备维护不及时
  if (ev.type === 'offline' && episode && episode.lowDays >= 1 && !has('maintenance_delayed')) {
    out.push({
      kind: 'maintenance_delayed',
      note: `离线发生在连续 ${episode.lowDays} 天低电未充电期间，设备维护不及时，纳入本次事件复盘`,
    })
  }
  if (!has('family_timeout') && ev.status === 'pending_family' && !ev.family.respondedAt && now - ev.family.notifiedAt > FAMILY_TIMEOUT_MS) {
    out.push({ kind: 'family_timeout', note: `家属超过 ${Math.round(FAMILY_TIMEOUT_MS / 60000)} 分钟未响应，社区接管处置` })
  }
  const noAnswer = ev.phoneAttempts.filter((a) => a.result === 'no_answer').length
  if (!has('phone_no_answer') && noAnswer >= PHONE_NO_ANSWER_LIMIT) {
    out.push({ kind: 'phone_no_answer', note: `老人电话连续 ${noAnswer} 次无人接听，建议立即上门` })
  }
  if (!has('door_no_answer') && ev.doorVisit?.result === 'no_answer') {
    out.push({ kind: 'door_no_answer', note: '网格员上门无人开门，建议联动物业/使用托管钥匙' })
  }
  return out
}

// ===================== 工具 =====================

export function nearestWorker(elder: Elder, workers: GridWorker[]): GridWorker {
  return (
    workers.find((w) => w.buildings.includes(elder.building)) ??
    [...workers].sort((a, b) => a.distanceMin - b.distanceMin)[0]
  )
}

/** 匹配可上门协助充电的就近志愿者（优先可接单） */
export function nearestVolunteer(elder: Elder, volunteers: Volunteer[]): Volunteer {
  const same = volunteers.filter((v) => v.buildings.includes(elder.building))
  const pool = same.length ? same : volunteers
  return (
    pool.find((v) => v.available) ??
    [...pool].sort((a, b) => a.distanceMin - b.distanceMin)[0]
  )
}

// ===================== 低电照护风险提示 =====================

/** 依据老人佩戴习惯与历史告警，生成低电照护风险提示 */
export function buildLowBatteryHints(elder: Elder, lowDays: number, relatedOfflineCount = 0): string[] {
  const hints: string[] = []
  const habit = elder.wearingHabit

  if (habit.includes('夜间') || habit.includes('充电')) {
    hints.push(`佩戴习惯为「${habit}」，通常夜间取下充电，请确认近两晚是否漏充或充电底座未接通`)
  } else if (habit.includes('忘记佩戴') || habit.includes('未戴')) {
    hints.push(`老人佩戴习惯为「${habit}」，低电可能伴随未佩戴，需上门确认手环是否在身上、是否接触不良`)
  } else if (habit.includes('全天佩戴')) {
    hints.push(`老人「${habit}」，手环不便自行取下，连续低电可能是充电底座故障或不会操作，建议上门协助`)
  } else {
    hints.push(`结合佩戴习惯「${habit}」，请确认充电条件与老人操作能力`)
  }

  if (elder.historyFalseAlarms > 0) {
    hints.push(`该设备历史误报 ${elder.historyFalseAlarms} 次，低电会进一步导致数据异常/漏报，需优先恢复电量`)
  }
  if (relatedOfflineCount > 0) {
    hints.push(`低电期间已发生 ${relatedOfflineCount} 次离线告警，可能因电量耗尽关机，存在照护盲区`)
  }
  if (lowDays >= LOW_BATTERY_DAYS) {
    hints.push(`已连续 ${lowDays} 天低电未充电，跌倒/心率/离线等告警可能无法上报，建议家属或社区立即上门检查老人与设备`)
  }
  return hints
}

/** 低电工单随时间推进：跨天累加低电天数，达到阈值升级为建议上门 */
export function advanceBatteryEpisode(ep: BatteryCareEpisode, now: number): BatteryCareEpisode {
  if (ep.status === 'resolved' || ep.status === 'replacement') return ep
  const today = dayKey(now)
  let { lowDays, lastDayKey, status } = ep
  if (today !== lastDayKey) {
    lowDays += 1
    lastDayKey = today
  }
  // 连续两天低电未充电：家属已提醒但仍未充电的，保持“家属已提醒/志愿者已安排”等更靠后的状态
  if (lowDays >= LOW_BATTERY_DAYS && status === 'monitoring') {
    status = 'visit_suggested'
  }
  if (lowDays !== ep.lowDays || lastDayKey !== ep.lastDayKey || status !== ep.status) {
    return { ...ep, lowDays, lastDayKey, status }
  }
  return ep
}

/**
 * 复盘：低电期间发生离线告警时，把设备维护不及时作为事件复盘的一部分
 */
export function buildMaintenanceReview(
  ev: AlertEvent,
  episode: BatteryCareEpisode | undefined,
): { delayed: boolean; detail: string; episodeId?: string } | undefined {
  if (ev.type !== 'offline' || !episode) return undefined
  const delayed = episode.lowDays >= 1
  if (!delayed) {
    return {
      delayed: false,
      detail: `离线前设备处于正常电量观察流程（本次低电工单 ${episode.id} 已跟踪），离线与低电维护无关`,
      episodeId: episode.id,
    }
  }
  const assistText = episode.chargeAssist
    ? `社区已安排志愿者 ${episode.chargeAssist.volunteerName} 协助`
    : episode.familyStillNotCharging
      ? '家属确认已提醒但老人仍未充电，志愿者尚未上门'
      : episode.familyRemindedAt
        ? '家属确认已提醒老人，充电情况未得到确认，社区未上门维护'
        : '家属尚未确认提醒，社区未上门维护'
  return {
    delayed: true,
    detail:
      `设备离线发生在连续 ${episode.lowDays} 天低电未充电期间，判定为设备维护不及时：${assistText}。` +
      `应将充电提醒/协助前置，避免电量耗尽导致离线与照护盲区。`,
    episodeId: episode.id,
  }
}

export const FALSE_REASONS = [
  '洗澡/充电时未佩戴手环',
  '手环佩戴过松导致误判',
  '静止阈值过低（看书/看电视久坐）',
  '心率阈值不适配老人基础心率',
  '电子围栏半径过小',
  '设备电量不足导致数据异常',
  '老人正常活动被误判',
]

/** 结案时自动生成设备调整建议 */
export function buildDeviceSuggestion(category: ClosureCategory, falseReason: string | undefined, ev: AlertEvent, elder: Elder): string {
  const tips: string[] = []
  if (category === 'device_false') {
    switch (falseReason) {
      case '洗澡/充电时未佩戴手环':
        tips.push('建议为老人配备防水充电底座并调整夜间充电时段提醒')
        break
      case '手环佩戴过松导致误判':
        tips.push('建议上门指导正确佩戴方式，腕带留一指空隙')
        break
      case '静止阈值过低（看书/看电视久坐）':
        tips.push(`建议将静止阈值由 ${elder.thresholds.stillnessMinutes} 分钟上调至 ${elder.thresholds.stillnessMinutes + 15} 分钟`)
        break
      case '心率阈值不适配老人基础心率':
        tips.push(`建议结合基础心率将心率区间由 ${elder.thresholds.heartRateLow}-${elder.thresholds.heartRateHigh} 放宽 5-10bpm`)
        break
      case '电子围栏半径过小':
        tips.push(`建议将电子围栏由 ${elder.thresholds.geofenceRadius} 米扩大至 ${elder.thresholds.geofenceRadius + 200} 米`)
        break
      case '设备电量不足导致数据异常':
        tips.push('建议开启低电自动提醒家属，并纳入每周设备巡检')
        break
      default:
        tips.push('建议复核告警阈值并结合老人作息重新标定')
    }
  }
  if (ev.batteryAtAlert <= LOW_BATTERY) tips.push('本次告警时电量偏低，建议为家属端开启充电提醒')
  if (category === 'care_gap') tips.push('建议提高巡访频次，并将家属提醒方式升级为电话+短信双通道')
  if (category === 'real_risk') tips.push('建议保持现有阈值灵敏度，必要时加装居家毫米波跌倒监测作为手环补充')
  return tips.join('；') || '设备运行正常，暂无调整建议'
}

/** 复盘结论含设备维护不及时时，追加设备/底座处置建议 */
export function maintenanceDelayedSuggestion(ev: AlertEvent): string | null {
  if (ev.closure?.maintenanceReview?.delayed) {
    return '低电期间发生离线，建议上门检查充电底座供电与手环电池，必要时更换充电底座或设备'
  }
  return null
}

/** 计算家属响应时长（分钟），未响应返回 null */
export function familyResponseMinutes(ev: AlertEvent, closedAt: number): number | null {
  if (ev.family.respondedAt) return Math.round((ev.family.respondedAt - ev.family.notifiedAt) / 60000)
  return null
}

/** 计算社区处置时效：告警发生到结案（分钟） */
export function communityHandleMinutes(ev: AlertEvent, closedAt: number): number {
  return Math.round((closedAt - ev.occurredAt) / 60000)
}

// ===================== 照护画像沉淀 =====================

export function sedimentProfile(profile: CareProfile, ev: AlertEvent, closure: Closure, now: number): CareProfile {
  const p: CareProfile = { ...profile, strategy: { ...profile.strategy }, riskTags: [...profile.riskTags] }
  if (closure.category === 'device_false') p.falseAlarmCount += 1
  if (closure.category === 'care_gap') p.careGapCount += 1
  if (closure.category === 'real_risk') p.realRiskCount += 1
  if (ev.family.timedOut) p.familyTimeoutCount += 1
  if (ev.type === 'offline') p.offlineCount += 1
  // 上门结果可能被后续入户结果覆盖，以升级记录为准
  if (ev.escalations.some((e) => e.kind === 'door_no_answer') || ev.doorVisit?.result === 'no_answer') p.doorNoAnswerCount += 1
  // 设备低电照护：低电期间离线且维护不及时（按事件复盘计数）
  if (closure.maintenanceReview?.delayed) p.maintenanceDelayedCount += 1

  return refreshProfile(p, now, ev.batteryAtAlert)
}

/** 依据画像当前计数重算风险等级、标签与照护策略建议 */
export function refreshProfile(p: CareProfile, now: number, batteryAtAlert?: number): CareProfile {
  const next: CareProfile = { ...p, strategy: { ...p.strategy }, riskTags: [...p.riskTags] }
  // 风险评分
  const score =
    next.realRiskCount * 3 +
    next.careGapCount * 2 +
    next.familyTimeoutCount * 2 +
    next.doorNoAnswerCount * 2 +
    next.maintenanceDelayedCount * 2 +
    next.offlineCount +
    next.lowBatteryCount +
    next.falseAlarmCount
  next.riskLevel = score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low'

  // 画像标签
  const tags: string[] = []
  if (next.familyTimeoutCount >= 2) tags.push('家属连续无人响应')
  if (next.offlineCount >= 2) tags.push('设备频繁离线')
  if (next.maintenanceDelayedCount >= 1) tags.push('设备维护不及时')
  if (next.lowBatteryCount >= 2) tags.push('反复低电未充电')
  if (next.chargeAssistCount >= 2) tags.push('需反复协助充电')
  if (next.doorNoAnswerCount >= 1) tags.push('上门无人在家')
  if (next.falseAlarmCount >= 3) tags.push('设备误报偏多')
  if (next.realRiskCount >= 1) tags.push('发生过真实风险')
  if (next.careGapCount >= 1) tags.push('存在照护缺口')
  next.riskTags = tags.length ? tags : ['状态平稳']

  // 照护策略建议
  next.strategy.visitFrequency =
    next.riskLevel === 'high'
      ? '每日上门巡访 + 早晚两次电话'
      : next.riskLevel === 'medium'
        ? '隔日电话 + 每周上门一次'
        : '每周电话巡访一次'
  next.strategy.deviceMaintenance =
    next.maintenanceDelayedCount >= 1
      ? '立即上门检修充电底座/设备，低电工单未闭环前每日跟踪电量'
      : next.offlineCount >= 2 || next.falseAlarmCount >= 3
        ? '安排上门检修设备并重新标定阈值'
        : next.lowBatteryCount >= 1 || (batteryAtAlert !== undefined && batteryAtAlert <= LOW_BATTERY)
          ? '每周提醒充电，纳入设备巡检清单'
          : '按季度常规巡检'
  next.strategy.familyReminder =
    next.familyTimeoutCount >= 2 ? '升级为电话+短信+APP三通道，并约谈家属明确照护责任' : 'APP推送 + 短信提醒'
  next.updatedAt = now
  return next
}

export function emptyProfile(elderId: string, now: number): CareProfile {
  return {
    elderId,
    falseAlarmCount: 0,
    careGapCount: 0,
    realRiskCount: 0,
    familyTimeoutCount: 0,
    offlineCount: 0,
    doorNoAnswerCount: 0,
    lowBatteryCount: 0,
    maintenanceDelayedCount: 0,
    chargeAssistCount: 0,
    riskLevel: 'low',
    riskTags: ['状态平稳'],
    strategy: {
      visitFrequency: '每周电话巡访一次',
      deviceMaintenance: '按季度常规巡检',
      familyReminder: 'APP推送 + 短信提醒',
    },
    updatedAt: now,
  }
}

export function alertTypeLabel(t: AlertType) {
  return ALERT_TYPE_LABEL[t]
}
