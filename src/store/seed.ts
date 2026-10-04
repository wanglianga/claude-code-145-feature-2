import { AlertEvent, BatteryCareEpisode, CareProfile, DutyStaff, Elder, GridWorker, Volunteer } from '../types'
import { assessSeverity, dayKey, generatePlan, emptyProfile } from './workflow'

const MIN = 60 * 1000
const HOUR = 60 * MIN

// ===================== 老人档案 =====================

export function seedElders(now: number): Elder[] {
  return [
    {
      id: 'e1',
      name: '王秀兰',
      age: 82,
      gender: '女',
      phone: '13901012233',
      address: '幸福里社区 3栋 2单元 502室',
      building: '3栋',
      chronicDiseases: ['高血压', '2型糖尿病'],
      contacts: [
        { name: '王莉', relation: '女儿', phone: '13811112222', isLocal: true, priority: 1 },
        { name: '张伟', relation: '女婿', phone: '13833334444', isLocal: true, priority: 2 },
      ],
      activityRange: ['小区中心花园', '南门菜市场', '社区卫生服务站'],
      wearingHabit: '白天佩戴，夜间23:00后取下充电',
      deviceId: 'BR-2024-0101',
      battery: 76,
      thresholds: { heartRateLow: 55, heartRateHigh: 120, stillnessMinutes: 45, geofenceRadius: 500, curfewTime: '21:00' },
      accessInfo: '单元门禁密码 2502#，电梯需刷卡（物业可远程授权）',
      keyCustody: '备用钥匙托管在社区服务站A柜（编号K-17）',
      historyFalseAlarms: 3,
      lastVisit: { at: now - 6 * 24 * HOUR, worker: '刘敏', note: '精神状态良好，提醒夜间充电时开启手机提醒' },
      trajectory: [
        { at: now - 5 * HOUR, place: '家中' },
        { at: now - 3 * HOUR, place: '小区中心花园' },
        { at: now - 1 * HOUR, place: '家中' },
      ],
    },
    {
      id: 'e2',
      name: '李建国',
      age: 76,
      gender: '男',
      phone: '13755556666',
      address: '幸福里社区 5栋 1单元 301室',
      building: '5栋',
      chronicDiseases: ['冠心病', '房颤'],
      contacts: [
        { name: '李明', relation: '儿子', phone: '13677778888', isLocal: false, priority: 1 },
        { name: '刘芳', relation: '儿媳', phone: '13699990000', isLocal: true, priority: 2 },
      ],
      activityRange: ['社区活动室', '北门棋牌角'],
      wearingHabit: '全天佩戴',
      deviceId: 'BR-2024-0102',
      battery: 15,
      thresholds: { heartRateLow: 50, heartRateHigh: 110, stillnessMinutes: 60, geofenceRadius: 600, curfewTime: '20:30' },
      accessInfo: '单元门禁对讲可远程开门',
      keyCustody: '未托管，儿媳持有备用钥匙',
      historyFalseAlarms: 1,
      lastVisit: { at: now - 2 * 24 * HOUR, worker: '赵强', note: '心率药按时服用，建议家属尽快充电' },
      trajectory: [
        { at: now - 8 * HOUR, place: '社区活动室' },
        { at: now - 2 * HOUR, place: '家中' },
      ],
    },
    {
      id: 'e3',
      name: '张桂芳',
      age: 88,
      gender: '女',
      phone: '13544445555',
      address: '幸福里社区 1栋 3单元 101室',
      building: '1栋',
      chronicDiseases: ['慢阻肺', '骨质疏松'],
      contacts: [
        { name: '张强', relation: '儿子', phone: '13566667777', isLocal: true, priority: 1 },
        { name: '张敏', relation: '女儿', phone: '13588889999', isLocal: true, priority: 2 },
      ],
      activityRange: ['家中', '楼下晒太阳区'],
      wearingHabit: '全天佩戴，洗澡时取下',
      deviceId: 'BR-2024-0103',
      battery: 91,
      thresholds: { heartRateLow: 55, heartRateHigh: 115, stillnessMinutes: 40, geofenceRadius: 300, curfewTime: '19:00' },
      accessInfo: '一楼无门禁，入户为指纹锁（儿子可远程开门）',
      keyCustody: '备用钥匙托管在社区服务站A柜（编号K-03）',
      historyFalseAlarms: 5,
      lastVisit: { at: now - 1 * 24 * HOUR, worker: '刘敏', note: '浴室已加装防滑垫与扶手，建议洗澡时使用防水挂袋' },
      trajectory: [
        { at: now - 4 * HOUR, place: '楼下晒太阳区' },
        { at: now - 1 * HOUR, place: '家中' },
      ],
    },
    {
      id: 'e4',
      name: '陈守仁',
      age: 79,
      gender: '男',
      phone: '13322221111',
      address: '幸福里社区 7栋 2单元 1204室',
      building: '7栋',
      chronicDiseases: ['高血压'],
      contacts: [
        { name: '陈静', relation: '女儿', phone: '13344445555', isLocal: true, priority: 1 },
      ],
      activityRange: ['社区图书馆', '滨河步道'],
      wearingHabit: '经常忘记佩戴（每周约2天未戴）',
      deviceId: 'BR-2024-0104',
      battery: 64,
      thresholds: { heartRateLow: 55, heartRateHigh: 125, stillnessMinutes: 50, geofenceRadius: 800, curfewTime: '21:30' },
      accessInfo: '单元门禁密码 7120#',
      keyCustody: '未托管',
      historyFalseAlarms: 2,
      lastVisit: { at: now - 4 * 24 * HOUR, worker: '孙丽', note: '已提醒老人出门前检查手环，女儿同意每晚电话提醒' },
      trajectory: [
        { at: now - 26 * HOUR, place: '滨河步道' },
        { at: now - 24 * HOUR, place: '家中' },
      ],
    },
    {
      id: 'e5',
      name: '周淑珍',
      age: 85,
      gender: '女',
      phone: '13100001111',
      address: '幸福里社区 2栋 1单元 203室',
      building: '2栋',
      chronicDiseases: ['糖尿病', '阿尔茨海默病（早期）'],
      contacts: [
        { name: '周军', relation: '儿子', phone: '13122223333', isLocal: false, priority: 1 },
        { name: '周萍', relation: '女儿', phone: '13144445555', isLocal: true, priority: 2 },
      ],
      activityRange: ['小区内', '社区食堂'],
      wearingHabit: '全天佩戴（女儿协助充电）',
      deviceId: 'BR-2024-0105',
      battery: 83,
      thresholds: { heartRateLow: 50, heartRateHigh: 120, stillnessMinutes: 45, geofenceRadius: 300, curfewTime: '18:30' },
      accessInfo: '单元门禁对讲，物业有备用门卡',
      keyCustody: '备用钥匙托管在社区服务站A柜（编号K-09）',
      historyFalseAlarms: 2,
      lastVisit: { at: now - 3 * 24 * HOUR, worker: '刘敏', note: '认知略有下降，建议女儿陪同熟悉回家路线' },
      trajectory: [
        { at: now - 6 * HOUR, place: '社区食堂' },
        { at: now - 5 * HOUR, place: '小区内花园' },
      ],
    },
  ]
}

// ===================== 人员 =====================

export const GRID_WORKERS: GridWorker[] = [
  { id: 'w1', name: '刘敏', phone: '18011110001', buildings: ['1栋', '2栋', '3栋'], distanceMin: 5 },
  { id: 'w2', name: '赵强', phone: '18011110002', buildings: ['4栋', '5栋', '6栋'], distanceMin: 8 },
  { id: 'w3', name: '孙丽', phone: '18011110003', buildings: ['7栋', '8栋', '9栋'], distanceMin: 10 },
]

export const DUTY_STAFF: DutyStaff[] = [
  { role: '值班员', name: '小吴', phone: '010-88990011' },
  { role: '社区医生', name: '陈医生', phone: '010-88990012' },
  { role: '物业值班', name: '老周', phone: '010-88990013' },
]

export const dutyText = DUTY_STAFF.map((d) => `${d.role} ${d.name}`).join(' / ')

/** 充电协助志愿者名单（家属已提醒仍未充电时，社区可安排上门） */
export const VOLUNTEERS: Volunteer[] = [
  { id: 'v1', name: '林阿姨（互助队）', phone: '18022220001', buildings: ['1栋', '2栋', '3栋'], distanceMin: 6, available: true },
  { id: 'v2', name: '小马（社区志愿者）', phone: '18022220002', buildings: ['4栋', '5栋', '6栋'], distanceMin: 7, available: true },
  { id: 'v3', name: '老郑（党员志愿岗）', phone: '18022220003', buildings: ['7栋', '8栋', '9栋'], distanceMin: 12, available: false },
]

// ===================== 种子事件 =====================

function firstContact(e: Elder) {
  return [...e.contacts].sort((a, b) => a.priority - b.priority)[0]
}

function makeEventBase(
  e: Elder,
  type: AlertEvent['type'],
  location: string,
  occurredAt: number,
  now: number,
  forceNight = false,
  batteryOverride?: number,
) {
  const isNight =
    forceNight ||
    (() => {
      const d = new Date(occurredAt)
      return d.getHours() >= 22 || d.getHours() < 6
    })()
  const battery = batteryOverride ?? e.battery
  const severity = assessSeverity(type, {
    isNight,
    location,
    battery,
    historyFalseAlarms: e.historyFalseAlarms,
  })
  const c = firstContact(e)
  return {
    elderId: e.id,
    type,
    severity,
    location,
    isNight,
    occurredAt,
    batteryAtAlert: battery,
    escalations: [],
    family: { contactName: c.name, contactPhone: c.phone, notifiedAt: occurredAt + 1 * MIN, timedOut: false },
    phoneAttempts: [],
    plan: generatePlan({
      elder: e,
      type,
      location,
      isNight,
      battery,
      severity,
      gridWorkers: GRID_WORKERS,
      dutyText,
    }),
  }
}

export function seedEvents(now: number): { events: AlertEvent[]; batteryEpisodes: BatteryCareEpisode[] } {
  const elders = seedElders(now)
  const [e1, e2, e3, e4] = elders

  // 1) 进行中：王秀兰 浴室跌倒（夜间场景）—— 待家属确认
  const ev1Occurred = now - 2 * MIN
  const ev1: AlertEvent = {
    ...makeEventBase(e1, 'fall', '家-浴室', ev1Occurred, now, true),
    id: 'EV-1001',
    status: 'pending_family',
    timeline: [
      { at: ev1Occurred, actor: 'device', kind: 'alert', title: '手环上报跌倒告警', detail: '位置：家-浴室，夜间时段，加速度突变后无起身动作' },
      { at: ev1Occurred + 1 * MIN, actor: 'system', kind: 'handle', title: '已通知紧急联系人', detail: '短信+APP推送：王莉（女儿）13811112222' },
    ],
  }

  // 2) 进行中：陈守仁 设备离线 —— 已派单上门
  const ev2Occurred = now - 40 * MIN
  const ev2: AlertEvent = {
    ...makeEventBase(e4, 'offline', '—（设备离线）', ev2Occurred, now),
    id: 'EV-1002',
    status: 'door_visit',
    doorVisit: { dispatchedAt: now - 15 * MIN, assignee: '孙丽', propertyInvolved: false, usedKeyCustody: false },
    timeline: [
      { at: ev2Occurred, actor: 'device', kind: 'alert', title: '手环离线超30分钟', detail: '最后在线位置：家中；最后电量 64%' },
      { at: ev2Occurred + 1 * MIN, actor: 'system', kind: 'handle', title: '已通知紧急联系人', detail: '短信+APP推送：陈静（女儿）' },
      { at: now - 30 * MIN, actor: 'family', kind: 'confirm', title: '家属请求上门查看', detail: '陈静：父亲电话没人接，麻烦社区上门看看' },
      { at: now - 15 * MIN, actor: 'community', kind: 'visit', title: '派单网格员上门', detail: '孙丽（负责7栋，约10分钟到达）已接单出发' },
    ],
  }
  ev2.family.respondedAt = now - 30 * MIN
  ev2.family.response = 'request_visit'
  ev2.family.note = '父亲电话没人接，麻烦社区上门看看'

  // 3) 已结案：李建国 心率异常 —— 真实风险，120就医
  const t0 = now - 3 * 24 * HOUR
  const ev3: AlertEvent = {
    ...makeEventBase(e2, 'heart_rate', '家-客厅', t0, now, false, 18),
    id: 'EV-0996',
    status: 'closed',
    doorVisit: { dispatchedAt: t0 + 8 * MIN, assignee: '赵强', arrivedAt: t0 + 16 * MIN, result: 'need_medical', note: '老人胸闷出汗，意识清楚', propertyInvolved: false, usedKeyCustody: false },
    medical: { called120: true, at: t0 + 18 * MIN, hospital: '区人民医院心内科', outcome: '房颤发作，急诊处理后留观一晚，次日出院' },
    followUp: { at: t0 + 26 * HOUR, by: '赵强', note: '电话回访：老人已回家休养，儿媳陪护，心率药已调整' },
    timeline: [
      { at: t0, actor: 'device', kind: 'alert', title: '手环上报心率异常', detail: '静息心率 138bpm，持续5分钟（阈值上限110）' },
      { at: t0 + 1 * MIN, actor: 'system', kind: 'handle', title: '已通知紧急联系人', detail: '李明（儿子，外地）、刘芳（儿媳，同城）' },
      { at: t0 + 4 * MIN, actor: 'family', kind: 'confirm', title: '家属要求上门', detail: '刘芳：我在单位赶不回去，请社区先上门' },
      { at: t0 + 8 * MIN, actor: 'community', kind: 'visit', title: '派单网格员上门', detail: '赵强（负责5栋）已接单' },
      { at: t0 + 16 * MIN, actor: 'community', kind: 'visit', title: '上门到达：老人胸闷出汗', detail: '意识清楚，血压偏高，建议立即送医' },
      { at: t0 + 18 * MIN, actor: 'community', kind: 'medical', title: '呼叫120急救', detail: '同步冠心病、房颤病史与用药清单' },
      { at: t0 + 55 * MIN, actor: 'medical', kind: 'medical', title: '送区人民医院心内科', detail: '房颤发作，急诊处理' },
      { at: t0 + 26 * HOUR, actor: 'community', kind: 'followup', title: '回访完成', detail: '老人已回家休养，儿媳陪护' },
      { at: t0 + 27 * HOUR, actor: 'community', kind: 'close', title: '事件结案', detail: '分类：真实风险' },
    ],
    closure: {
      closedAt: t0 + 27 * HOUR,
      closedBy: '小吴',
      category: 'real_risk',
      deviceSuggestion: '建议保持现有阈值灵敏度，必要时加装居家毫米波跌倒监测作为手环补充；本次告警时电量偏低，建议为家属端开启充电提醒',
      familyResponseMinutes: 4,
      communityHandleMinutes: 1620,
      summary: '心率异常告警属实，老人房颤发作。家属4分钟内响应，网格员16分钟到达，120联动及时，送医后次日出院。处置链条完整。',
    },
  }
  ev3.family.respondedAt = t0 + 4 * MIN
  ev3.family.response = 'request_visit'
  ev3.family.note = '我在单位赶不回去，请社区先上门'
  ev3.escalations = [{ kind: 'low_battery', at: t0 + 1 * MIN, note: '告警时设备电量仅 18%，需同步安排设备维护' }]

  // 4) 已结案：张桂芳 长时间静止 —— 设备误报（洗澡未佩戴）
  const s0 = now - 1 * 24 * HOUR
  const ev4: AlertEvent = {
    ...makeEventBase(e3, 'stillness', '家-卫生间外', s0, now),
    id: 'EV-0998',
    status: 'closed',
    followUp: { at: s0 + 20 * HOUR, by: '刘敏', note: '上门回访：老人安好，已指导洗澡时使用防水挂袋' },
    timeline: [
      { at: s0, actor: 'device', kind: 'alert', title: '手环上报长时间静止', detail: '静止超40分钟，位置：家中（手环置于卫生间外台面）' },
      { at: s0 + 1 * MIN, actor: 'system', kind: 'handle', title: '已通知紧急联系人', detail: '张强（儿子）' },
      { at: s0 + 6 * MIN, actor: 'family', kind: 'confirm', title: '家属确认误报', detail: '张强：母亲在洗澡，手环摘了放在外面' },
      { at: s0 + 20 * HOUR, actor: 'community', kind: 'followup', title: '回访完成', detail: '老人安好，指导防水挂袋使用' },
      { at: s0 + 21 * HOUR, actor: 'community', kind: 'close', title: '事件结案', detail: '分类：设备误报' },
    ],
    closure: {
      closedAt: s0 + 21 * HOUR,
      closedBy: '小吴',
      category: 'device_false',
      falseReason: '洗澡/充电时未佩戴手环',
      deviceSuggestion: '建议为老人配备防水充电底座并调整夜间充电时段提醒',
      familyResponseMinutes: 6,
      communityHandleMinutes: 1260,
      summary: '静止告警系洗澡时摘下手环导致的误报。家属6分钟确认，未触发上门。建议调整佩戴习惯与充电提醒。',
    },
  }
  ev4.family.respondedAt = s0 + 6 * MIN
  ev4.family.response = 'false_alarm'
  ev4.family.note = '母亲在洗澡，手环摘了放在外面'

  // 5) 进行中：李建国 设备离线 —— 连续两天低电未充电期间发生，家属已提醒但仍未充电
  //    低电照护工单 BC-2001 与事件联动
  const lowStart = now - 2 * 24 * HOUR + 3 * HOUR // 前天夜间首次低电
  const ev5Occurred = now - 35 * MIN
  const ev5: AlertEvent = {
    ...makeEventBase(e2, 'offline', '—（设备离线）', ev5Occurred, now, false, 6),
    id: 'EV-1003',
    status: 'door_visit',
    batteryEpisodeId: 'BC-2001',
    doorVisit: { dispatchedAt: now - 20 * MIN, assignee: '赵强', propertyInvolved: false, usedKeyCustody: false },
    escalations: [
      { kind: 'low_battery', at: ev5Occurred, note: '告警时设备电量仅 6%，需同步安排设备维护' },
      { kind: 'maintenance_delayed', at: ev5Occurred + 1 * MIN, note: '离线发生在连续 2 天低电未充电期间，设备维护不及时，纳入本次事件复盘' },
    ],
    timeline: [
      { at: lowStart, actor: 'device', kind: 'battery', title: '设备电量进入低电（16%）', detail: '系统已向家属推送充电提醒' },
      { at: now - 1 * 24 * HOUR, actor: 'device', kind: 'battery', title: '次日仍低电（12%）未充电', detail: '连续低电，页面提示家属/社区上门检查' },
      { at: ev5Occurred, actor: 'device', kind: 'alert', title: '手环离线超30分钟', detail: '最后在线位置：家中；最后电量 6%，疑因电量耗尽关机' },
      { at: ev5Occurred + 1 * MIN, actor: 'system', kind: 'escalation', title: '升级：低电期间设备离线（维护不及时）', detail: '连续2天低电未充电，纳入事件复盘' },
      { at: ev5Occurred + 2 * MIN, actor: 'system', kind: 'handle', title: '已通知紧急联系人', detail: '短信+APP推送：李明（儿子，外地）、刘芳（儿媳，同城）' },
      { at: now - 25 * MIN, actor: 'family', kind: 'confirm', title: '家属要求上门查看', detail: '刘芳：昨晚电话提醒过充电，爸说等会儿充，刚刚电话没人接，请社区上门看看' },
      { at: now - 20 * MIN, actor: 'community', kind: 'visit', title: '派单网格员上门', detail: '赵强（负责5栋，约8分钟到达）已接单；可同步安排志愿者协助充电' },
    ],
  }
  ev5.family.respondedAt = now - 25 * MIN
  ev5.family.response = 'request_visit'
  ev5.family.note = '昨晚已电话提醒充电，不确定是否充上，请求社区上门看看'

  // 低电照护工单：连续两天低电、家属已提醒仍未充电
  const bc2001: BatteryCareEpisode = {
    id: 'BC-2001',
    elderId: 'e2',
    deviceId: e2.deviceId,
    startedAt: lowStart,
    lowDays: 2,
    lastDayKey: dayKey(now - 1 * MIN),
    samples: [
      { at: lowStart, battery: 16, source: 'device' },
      { at: now - 1 * 24 * HOUR, battery: 12, source: 'device' },
      { at: ev5Occurred, battery: 6, source: 'device' },
    ],
    reminders: [
      { at: lowStart, by: '系统', role: 'system', kind: 'auto_notice', note: '低电自动推送家属：请提醒老人充电' },
      { at: now - 1 * 24 * HOUR + 2 * HOUR, by: '系统', role: 'system', kind: 'auto_notice', note: '连续低电第二天，再次推送并提示可上门检查' },
      { at: now - 25 * MIN, by: '刘芳', role: 'family', kind: 'family_reminded', note: '昨晚已电话提醒老人，老人答应稍后充电' },
    ],
    familyRemindedAt: now - 25 * MIN,
    familyStillNotCharging: false,
    offlineAlertIds: ['EV-1003'],
    status: 'family_reminded',
    replacement: {
      at: lowStart,
      decidedBy: '待决定',
      option: 'keep',
      reason: '该设备 10 天前曾发生连续低电（BC-1998，志愿者上门协助后恢复），本次为再次低电，待确认是否更换设备或充电底座',
      relatedEpisodeId: 'BC-1998',
    },
  }

  // 历史低电工单（10天前已闭环）：志愿者上门协助充电恢复 —— 用于"再次低电提示更换"
  const pastStart = now - 11 * 24 * HOUR
  const pastResolved = now - 10 * 24 * HOUR
  const bc1998: BatteryCareEpisode = {
    id: 'BC-1998',
    elderId: 'e2',
    deviceId: e2.deviceId,
    startedAt: pastStart,
    lowDays: 2,
    lastDayKey: dayKey(pastResolved),
    samples: [
      { at: pastStart, battery: 14, source: 'device' },
      { at: pastStart + 1 * 24 * HOUR, battery: 9, source: 'device' },
      { at: pastResolved, battery: 88, source: 'manual' },
    ],
    reminders: [
      { at: pastStart, by: '系统', role: 'system', kind: 'auto_notice', note: '低电自动推送家属' },
      { at: pastResolved, by: '小马（社区志愿者）', role: 'volunteer', kind: 'volunteer_assist', note: '上门协助插上充电底座，手环恢复充电' },
    ],
    familyRemindedAt: pastStart + 3 * HOUR,
    chargeAssist: {
      volunteerName: '小马（社区志愿者）',
      volunteerPhone: '18022220002',
      assignedAt: pastResolved - 40 * MIN,
      arrivedAt: pastResolved - 30 * MIN,
      result: 'charged',
      note: '老人不会对准充电触点，志愿者协助后正常充电',
    },
    offlineAlertIds: [],
    status: 'resolved',
    resolution: {
      at: pastResolved,
      helperName: '小马（社区志愿者）',
      helperRole: 'volunteer',
      recoveredAt: pastResolved - 30 * MIN,
      batteryAfter: 88,
      note: '志愿者上门协助充电，电量恢复',
    },
    closedAt: pastResolved,
  }

  return {
    events: [ev1, ev5, ev2, ev3, ev4],
    batteryEpisodes: [bc2001, bc1998],
  }
}

// ===================== 初始照护画像 =====================

export function seedProfiles(now: number): Record<string, CareProfile> {
  const mk = (id: string, patch: Partial<CareProfile>): CareProfile => ({ ...emptyProfile(id, now), ...patch })
  return {
    e1: mk('e1', {
      falseAlarmCount: 3,
      riskLevel: 'low',
      riskTags: ['设备误报偏多'],
      strategy: { visitFrequency: '每周电话巡访一次', deviceMaintenance: '按季度常规巡检', familyReminder: 'APP推送 + 短信提醒' },
    }),
    e2: mk('e2', {
      realRiskCount: 1,
      lowBatteryCount: 1,
      chargeAssistCount: 1,
      riskLevel: 'medium',
      riskTags: ['发生过真实风险'],
      strategy: { visitFrequency: '隔日电话 + 每周上门一次', deviceMaintenance: '每周提醒充电，纳入设备巡检清单', familyReminder: 'APP推送 + 短信提醒' },
    }),
    e3: mk('e3', {
      falseAlarmCount: 5,
      riskLevel: 'medium',
      riskTags: ['设备误报偏多'],
      strategy: { visitFrequency: '隔日电话 + 每周上门一次', deviceMaintenance: '安排上门检修设备并重新标定阈值', familyReminder: 'APP推送 + 短信提醒' },
    }),
    e4: mk('e4', {
      offlineCount: 3,
      riskLevel: 'medium',
      riskTags: ['设备频繁离线'],
      strategy: { visitFrequency: '隔日电话 + 每周上门一次', deviceMaintenance: '安排上门检修设备并重新标定阈值', familyReminder: 'APP推送 + 短信提醒' },
    }),
    e5: mk('e5', {
      careGapCount: 1,
      familyTimeoutCount: 1,
      riskLevel: 'medium',
      riskTags: ['存在照护缺口'],
      strategy: { visitFrequency: '隔日电话 + 每周上门一次', deviceMaintenance: '按季度常规巡检', familyReminder: 'APP推送 + 短信提醒' },
    }),
  }
}
