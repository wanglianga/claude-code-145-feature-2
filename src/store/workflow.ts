import {
  AlertEvent,
  AlertType,
  ALERT_TYPE_LABEL,
  BatteryCareTask,
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
/** 连续低电多少天未充电即判定为照护风险（老人手环连续两天低电且未充电） */
export const LOW_BATTERY_DAYS = 2
export const LOW_BATTERY_MS = LOW_BATTERY_DAYS * 24 * 60 * 60 * 1000

export const isNightTime = (d: Date) => d.getHours() >= 22 || d.getHours() < 6

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
  /** 连续低电未充电天数（>0 时生成低电照护步骤） */
  lowBatteryDays?: number
}

/** 依据告警类型、最近轨迹、历史误报、家属联系方式、值班人员生成处置流程 */
export function generatePlan(ctx: PlanContext): PlanStep[] {
  const { elder, type, location, isNight, battery, severity, gridWorkers, dutyText, lowBatteryDays = 0 } = ctx
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

  if (lowBatteryDays >= LOW_BATTERY_DAYS) {
    steps.push({
      key: 'battery_care',
      title: '连续低电照护干预',
      desc: `设备已连续 ${lowBatteryDays} 天低电（≤${LOW_BATTERY}%）且未充电：页面提示家属或社区按佩戴习惯与历史告警上门检查；家属确认已提醒仍未充电时安排志愿者协助充电，恢复后登记协助人与恢复时间`,
      reason: `设备自连续低电起未恢复充电，电量耗尽将导致离线与漏报，属照护风险`,
      conditional: true,
    })
  }

  if (battery <= LOW_BATTERY || type === 'offline') {
    steps.push({
      key: 'device_maintain',
      title: '设备维护',
      desc: battery <= LOW_BATTERY
        ? `告警时电量仅 ${battery}%，安排充电提醒或上门更换设备${
            type === 'offline' ? '；本次离线需核查是否为低电关机、设备维护是否不及时' : ''
          }`
        : '设备频繁离线，安排上门检修并核对佩戴习惯',
      reason: battery <= LOW_BATTERY ? '低电量影响告警可靠性' : '离线告警指向设备/佩戴问题',
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
  if (has('battery_care')) {
    const taskDone = !!ev.batteryCareTaskId
    s.battery_care = taskDone ? (ev.status === 'closed' ? 'done' : 'active') : 'pending'
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
export function checkEscalations(ev: AlertEvent, elder: Elder, now: number): EscalationCheck[] {
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
  if (!has('battery_unmaintained') && ev.type === 'offline' && ev.batteryCareTaskId) {
    out.push({
      kind: 'battery_unmaintained',
      note: ev.batteryCareNote ?? '离线发生在设备连续低电未充电期间，设备维护不及时，纳入事件复盘',
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

/** 就近匹配协助充电/上门检查的志愿者 */
export function nearestVolunteer(elder: Elder, volunteers: Volunteer[]): Volunteer {
  return (
    volunteers.find((v) => v.buildings.includes(elder.building)) ??
    [...volunteers].sort((a, b) => a.distanceMin - b.distanceMin)[0]
  )
}

/** 连续低电天数（不足一天按已持续天数计；未低电返回 0） */
export function lowBatteryDaysOf(elder: Elder, now: number): number {
  if (elder.battery > LOW_BATTERY || elder.lowBatterySince == null) return 0
  return Math.max(0, Math.floor((now - elder.lowBatterySince) / (24 * 60 * 60 * 1000)))
}

/**
 * 根据老人佩戴习惯和历史告警生成家属/社区上门检查提示。
 * 佩戴习惯关键词 + 历史离线/误报共同决定检查重点。
 */
export function buildBatteryRiskTips(elder: Elder, recentOfflineCount: number, repeatIndex: number): string[] {
  const tips: string[] = []
  const habit = elder.wearingHabit
  if (habit.includes('夜间') || habit.includes('取下充电')) {
    tips.push(`佩戴习惯为「${habit}」：检查老人是否睡前忘记接上充电器、充电线/床头插座是否可用`)
  } else if (habit.includes('忘记佩戴')) {
    tips.push(`老人「${habit}」：上门确认手环是否长期被搁置未戴、剩余电量是否从未消耗性补电`)
  } else if (habit.includes('洗澡')) {
    tips.push('老人洗澡时会取下：检查摘下后是否忘记戴回并充电，确认防水挂袋/充电位位置')
  } else if (habit.includes('协助')) {
    tips.push(`充电依赖家属协助（${habit}）：联系协助人确认近期是否漏协助，必要时改由志愿者兜底`)
  } else {
    tips.push(`佩戴习惯为「${habit}」：上门确认充电底座是否通电、老人是否掌握充电操作`)
  }
  if (recentOfflineCount >= 2) {
    tips.push(`该设备历史离线 ${recentOfflineCount} 次：低电极易导致自动关机离线，需优先恢复电量`)
  }
  if (elder.historyFalseAlarms >= 3) {
    tips.push(`历史误报 ${elder.historyFalseAlarms} 次：低电可能造成数据异常误报，充电后观察一晚数据质量`)
  }
  tips.push(`上门同时查看老人本人状态：慢${elder.chronicDiseases.join('、')}，低电期间手环无数据不等于老人平安`)
  if (repeatIndex >= 2) {
    tips.push(`这是第 ${repeatIndex} 次连续低电未充电，本次恢复后评估更换设备或充电底座`)
  }
  return tips
}

/** 低电期间发生离线告警时，生成事件复盘用的设备维护说明 */
export function buildBatteryCareNote(task: BatteryCareTask | undefined, elder: Elder, now: number): string | undefined {
  if (!task) return undefined
  const days = Math.max(1, Math.floor((now - task.lowSince) / (24 * 60 * 60 * 1000)))
  const parts: string[] = [`设备已连续低电 ${days} 天未充电，本次离线发生在低电期间，判定为设备维护不及时，纳入事件复盘`]
  if (task.familyRemindedAt) parts.push('家属此前已确认提醒老人充电但仍未恢复')
  if (task.volunteerName) parts.push(`社区已安排志愿者${task.volunteerName}协助（以离线发生时的处置进度为准）`)
  parts.push(`佩戴习惯：${elder.wearingHabit}`)
  return parts.join('；')
}

/** 再次低电时的更换建议 */
export function replacementTip(repeatIndex: number): string {
  if (repeatIndex <= 1) return ''
  return `该设备已第 ${repeatIndex} 次连续低电未充电，建议确认充电底座是否接触不良，必要时更换充电底座；若更换后仍反复低电则更换整只手环`
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
  if (ev.batteryCareTaskId) {
    tips.push('本次事件发生在连续低电未充电期间，须闭环低电照护任务：登记充电协助人与恢复时间，反复低电则更换设备/充电底座')
  }
  if (ev.batteryAtAlert <= LOW_BATTERY) tips.push('本次告警时电量偏低，建议为家属端开启充电提醒')
  if (category === 'care_gap') tips.push('建议提高巡访频次，并将家属提醒方式升级为电话+短信双通道')
  if (category === 'real_risk') tips.push('建议保持现有阈值灵敏度，必要时加装居家毫米波跌倒监测作为手环补充')
  return tips.join('；') || '设备运行正常，暂无调整建议'
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

/** 由各项计数重算风险等级、画像标签与照护策略（事件结案与低电照护任务完成共用） */
export function applyProfileRules(p: CareProfile, now: number): CareProfile {
  const score =
    p.realRiskCount * 3 +
    p.careGapCount * 2 +
    p.familyTimeoutCount * 2 +
    p.doorNoAnswerCount * 2 +
    p.offlineCount +
    p.lowBatteryCount * 2 +
    p.falseAlarmCount
  p.riskLevel = score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low'

  // 画像标签
  const tags: string[] = []
  if (p.familyTimeoutCount >= 2) tags.push('家属连续无人响应')
  if (p.offlineCount >= 2) tags.push('设备频繁离线')
  if (p.doorNoAnswerCount >= 1) tags.push('上门无人在家')
  if (p.lowBatteryCount >= 1) tags.push('连续低电未充电')
  if (p.falseAlarmCount >= 3) tags.push('设备误报偏多')
  if (p.realRiskCount >= 1) tags.push('发生过真实风险')
  if (p.careGapCount >= 1) tags.push('存在照护缺口')
  p.riskTags = tags.length ? tags : ['状态平稳']

  // 照护策略建议
  p.strategy.visitFrequency =
    p.riskLevel === 'high' ? '每日上门巡访 + 早晚两次电话' : p.riskLevel === 'medium' ? '隔日电话 + 每周上门一次' : '每周电话巡访一次'
  p.strategy.deviceMaintenance =
    p.lowBatteryCount >= 1
      ? '低电照护重点：连续两天未充电即安排志愿者上门协助，反复低电更换设备/充电底座'
      : p.offlineCount >= 2 || p.falseAlarmCount >= 3
        ? '安排上门检修设备并重新标定阈值'
        : '按季度常规巡检'
  p.strategy.familyReminder =
    p.familyTimeoutCount >= 2 ? '升级为电话+短信+APP三通道，并约谈家属明确照护责任' : 'APP推送 + 短信提醒'
  p.updatedAt = now
  return p
}

export function sedimentProfile(profile: CareProfile, ev: AlertEvent, closure: Closure, now: number): CareProfile {
  const p: CareProfile = { ...profile, strategy: { ...profile.strategy }, riskTags: [...profile.riskTags] }
  if (closure.category === 'device_false') p.falseAlarmCount += 1
  if (closure.category === 'care_gap') p.careGapCount += 1
  if (closure.category === 'real_risk') p.realRiskCount += 1
  if (ev.family.timedOut) p.familyTimeoutCount += 1
  if (ev.type === 'offline') p.offlineCount += 1
  // 上门结果可能被后续入户结果覆盖，以升级记录为准
  if (ev.escalations.some((e) => e.kind === 'door_no_answer') || ev.doorVisit?.result === 'no_answer') p.doorNoAnswerCount += 1
  // 低电照护风险在任务建单时已沉淀画像，事件结案不再重复计数
  return applyProfileRules(p, now)
}

/** 低电照护任务完成（恢复充电或更换设备）后沉淀画像 */
export function sedimentBatteryTask(profile: CareProfile, now: number): CareProfile {
  const p: CareProfile = { ...profile, strategy: { ...profile.strategy }, riskTags: [...profile.riskTags] }
  p.lowBatteryCount += 1
  return applyProfileRules(p, now)
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
