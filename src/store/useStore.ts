import { create } from 'zustand'
import {
  AlertEvent,
  AlertType,
  ALERT_TYPE_LABEL,
  BatteryCareRecord,
  BatteryCareTask,
  CareProfile,
  ClosureCategory,
  CLOSURE_LABEL,
  Elder,
  ESCALATION_LABEL,
  EventStatus,
  Session,
  Thresholds,
  TimelineEntry,
  Volunteer,
} from '../types'
import { DUTY_STAFF, GRID_WORKERS, VOLUNTEERS, dutyText, seedElders, seedEvents, seedProfiles, seedBatteryTasks } from './seed'
import {
  LOW_BATTERY,
  LOW_BATTERY_MS,
  assessSeverity,
  buildBatteryCareNote,
  buildBatteryRiskTips,
  buildDeviceSuggestion,
  checkEscalations,
  communityHandleMinutes,
  emptyProfile,
  familyResponseMinutes,
  generatePlan,
  isNightTime,
  lowBatteryDaysOf,
  nearestVolunteer,
  nearestWorker,
  replacementTip,
  sedimentBatteryTask,
  sedimentProfile,
} from './workflow'

let idSeq = 1002
const nextEventId = () => `EV-${++idSeq}`
let batterySeq = 1
const nextBatteryTaskId = () => `BC-${String(++batterySeq).padStart(4, '0')}`

export interface StoreState {
  session: Session | null
  timeOffset: number // 演示用时间快进（毫秒）
  elders: Elder[]
  events: AlertEvent[]
  profiles: Record<string, CareProfile>
  batteryTasks: BatteryCareTask[]

  now: () => number
  login: (role: 'community' | 'family', userName: string, elderId?: string) => void
  logout: () => void
  fastForward: (minutes: number) => void
  tick: () => void

  raiseAlert: (elderId: string, type: AlertType, location: string) => void
  familyRespond: (eventId: string, response: NonNullable<AlertEvent['family']['response']>, note: string) => void
  recordPhoneAttempt: (eventId: string, result: 'answered' | 'no_answer', note: string) => void
  dispatchVisit: (eventId: string, assignee: string) => void
  recordArrival: (eventId: string) => void
  recordVisitResult: (eventId: string, result: 'ok' | 'no_answer' | 'need_medical', note: string) => void
  involveProperty: (eventId: string, useKey: boolean) => void
  call120: (eventId: string, by: 'family' | 'community') => void
  recordMedical: (eventId: string, hospital: string, outcome: string) => void
  recordFollowUp: (eventId: string, note: string) => void
  closeEvent: (eventId: string, category: ClosureCategory, falseReason: string | undefined, summary: string) => void

  /** 模拟手环电量上报（充电恢复 / 再次低电均通过它驱动） */
  reportBattery: (elderId: string, battery: number) => void
  /** 家属确认已提醒老人充电 */
  familyRemindedCharging: (taskId: string, note: string) => void
  /** 社区安排志愿者上门协助充电/检查 */
  dispatchVolunteer: (taskId: string, volunteerId?: string) => void
  /** 记录志愿者上门 */
  recordVolunteerArrival: (taskId: string, note: string) => void
  /** 低电处理完成：记录充电协助人、恢复时间（电量恢复） */
  resolveBatteryTask: (taskId: string, assistedBy: string, note: string) => void
  /** 再次低电：登记更换设备或充电底座的处置决定 */
  decideReplacement: (taskId: string, kind: 'device' | 'charger', note: string) => void

  updateThresholds: (elderId: string, t: Thresholds) => void
  updateWearingHabit: (elderId: string, habit: string) => void
  updateStrategy: (elderId: string, strategy: CareProfile['strategy']) => void
}

function pushTimeline(ev: AlertEvent, entry: TimelineEntry): AlertEvent {
  return { ...ev, timeline: [...ev.timeline, entry] }
}

function applyEscalations(ev: AlertEvent, elder: Elder, now: number): AlertEvent {
  const fresh = checkEscalations(ev, elder, now)
  if (!fresh.length) return ev
  let next = { ...ev, escalations: [...ev.escalations] }
  for (const f of fresh) {
    next.escalations.push({ kind: f.kind, at: now, note: f.note })
    next = pushTimeline(next, { at: now, actor: 'system', kind: 'escalation', title: `升级：${ESCALATION_LABEL[f.kind]}`, detail: f.note })
    if (f.kind === 'family_timeout') next.family = { ...next.family, timedOut: true }
  }
  return next
}

function pushBatteryRecord(t: BatteryCareTask, rec: Omit<BatteryCareRecord, 'at'>, now: number): BatteryCareTask {
  return { ...t, records: [...t.records, { ...rec, at: now }] }
}

/** 找出老人当前未闭环的连续低电任务 */
export function activeBatteryTask(tasks: BatteryCareTask[], elderId: string): BatteryCareTask | undefined {
  return tasks.find((t) => t.elderId === elderId && t.status !== 'resolved' && t.status !== 'replaced')
}

/**
 * 连续两天低电且未充电 → 生成照护任务（已存在未闭环任务时不重复建单）。
 * repeatIndex 取该老人既往低电任务数 + 1。
 */
function ensureBatteryTask(tasks: BatteryCareTask[], elder: Elder, now: number, recentOfflineCount = 0): { tasks: BatteryCareTask[]; task?: BatteryCareTask; created: boolean } {
  if (elder.battery > LOW_BATTERY || elder.lowBatterySince == null) return { tasks, created: false }
  if (now - elder.lowBatterySince < LOW_BATTERY_MS) return { tasks, created: false }
  const existing = activeBatteryTask(tasks, elder.id)
  if (existing) return { tasks, task: existing, created: false }
  const repeatIndex = tasks.filter((t) => t.elderId === elder.id).length + 1
  const task: BatteryCareTask = {
    id: nextBatteryTaskId(),
    elderId: elder.id,
    deviceId: elder.deviceId,
    lowSince: elder.lowBatterySince,
    detectedAt: now,
    battery: elder.battery,
    status: 'reminding',
    repeatIndex,
    riskTips: buildBatteryRiskTips(elder, recentOfflineCount, repeatIndex),
    records: [
      {
        at: now,
        by: '系统',
        action: 'detect',
        note: `手环连续 ${Math.floor((now - elder.lowBatterySince) / 86400000)} 天电量 ≤${LOW_BATTERY}% 且未充电，已提示家属或社区按佩戴习惯与历史告警上门检查`,
      },
    ],
  }
  return { tasks: [task, ...tasks], task, created: true }
}

export const useStore = create<StoreState>((set, get) => {
  const boot = Date.now()
  return {
    session: null,
    timeOffset: 0,
    elders: seedElders(boot),
    events: seedEvents(boot),
    profiles: seedProfiles(boot),
    batteryTasks: seedBatteryTasks(boot),

    now: () => Date.now() + get().timeOffset,

    login: (role, userName, elderId) => set({ session: { role, userName, elderId } }),
    logout: () => set({ session: null }),

    fastForward: (minutes) => {
      set((s) => ({ timeOffset: s.timeOffset + minutes * 60 * 1000 }))
      get().tick()
    },

    /** 周期性检查：未结案事件的升级情形 + 连续两天低电照护任务 */
    tick: () => {
      const now = get().now()
      set((s) => {
        let batteryTasks = s.batteryTasks
        let profiles = s.profiles
        const elders = s.elders
        for (const elder of elders) {
          const r = ensureBatteryTask(batteryTasks, elder, now, s.profiles[elder.id]?.offlineCount ?? 0)
          batteryTasks = r.tasks
          // 识别到连续低电照护风险即沉淀画像（任务进行中即反映，闭环不重复计数）
          if (r.created) {
            const p = sedimentBatteryTask(profiles[elder.id] ?? emptyProfile(elder.id, now), now)
            profiles = { ...profiles, [elder.id]: p }
          }
        }
        const events = s.events.map((ev) => {
          if (ev.status === 'closed') return ev
          const elder = s.elders.find((e) => e.id === ev.elderId)
          if (!elder) return ev
          return applyEscalations(ev, elder, now)
        })
        return { events, batteryTasks, profiles }
      })
    },

    /** 手环上报新告警 */
    raiseAlert: (elderId, type, location) => {
      const s = get()
      const elder = s.elders.find((e) => e.id === elderId)
      if (!elder) return
      const now = s.now()
      const isNight = isNightTime(new Date(now))
      const severity = assessSeverity(type, {
        isNight,
        location,
        battery: elder.battery,
        historyFalseAlarms: elder.historyFalseAlarms,
      })
      const contact = [...elder.contacts].sort((a, b) => a.priority - b.priority)[0]
      const lowDays = lowBatteryDaysOf(elder, now)
      // 低电期间发生离线告警：关联连续低电照护任务，作为事件复盘的一部分
      const batteryTask = type === 'offline' ? activeBatteryTask(s.batteryTasks, elderId) : undefined
      const batteryCareNote = batteryTask ? buildBatteryCareNote(batteryTask, elder, now) : undefined
      let ev: AlertEvent = {
        id: nextEventId(),
        elderId,
        type,
        severity,
        location,
        isNight,
        occurredAt: now,
        batteryAtAlert: elder.battery,
        batteryCareTaskId: batteryTask?.id,
        batteryCareNote,
        status: 'pending_family',
        plan: generatePlan({
          elder,
          type,
          location,
          isNight,
          battery: elder.battery,
          severity,
          gridWorkers: GRID_WORKERS,
          dutyText,
          lowBatteryDays: lowDays,
        }),
        escalations: [],
        family: { contactName: contact.name, contactPhone: contact.phone, notifiedAt: now, timedOut: false },
        phoneAttempts: [],
        timeline: [
          { at: now, actor: 'device', kind: 'alert', title: `手环上报${ALERT_TYPE_LABEL[type]}`, detail: `位置：${location}${isNight ? '，夜间时段' : ''}` },
          { at: now, actor: 'system', kind: 'handle', title: '已通知紧急联系人', detail: `短信+APP推送：${contact.name}（${contact.relation}）${contact.phone}` },
        ],
      }
      if (batteryTask && batteryCareNote) {
        ev = pushTimeline(ev, {
          at: now,
          actor: 'system',
          kind: 'battery',
          title: '关联低电照护任务',
          detail: `离线发生在设备连续低电期间（${batteryTask.id}）：${batteryCareNote}`,
        })
      }
      ev = applyEscalations(ev, elder, now)
      set((st) => ({ events: [ev, ...st.events] }))
    },

    /** 家属端操作 */
    familyRespond: (eventId, response, note) => {
      const now = get().now()
      const labelMap = {
        false_alarm: '家属确认误报',
        request_call: '家属请求电话核实',
        request_visit: '家属要求上门',
        called_120: '家属直接拨打120',
      } as const
      const statusMap: Record<typeof response, EventStatus> = {
        false_alarm: 'follow_up',
        request_call: 'family_verifying',
        request_visit: 'door_visit',
        called_120: 'medical',
      }
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || ev.family.respondedAt) return ev
          let next: AlertEvent = {
            ...ev,
            status: statusMap[response],
            family: { ...ev.family, respondedAt: now, response, note },
          }
          next = pushTimeline(next, { at: now, actor: 'family', kind: 'confirm', title: labelMap[response], detail: note || undefined })
          if (response === 'called_120') {
            next.medical = { called120: true, at: now }
            next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: '家属已直接拨打120，社区同步联动' }]
            next = pushTimeline(next, { at: now, actor: 'system', kind: 'escalation', title: '升级：需联动120急救', detail: '家属已拨打120，社区值班员同步跟进' })
          }
          return next
        }),
      }))
    },

    /** 社区电话核实 */
    recordPhoneAttempt: (eventId, result, note) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId) return ev
          const by = s.session?.userName ?? '值班员'
          let next: AlertEvent = { ...ev, phoneAttempts: [...ev.phoneAttempts, { at: now, by, result, note }] }
          next = pushTimeline(next, {
            at: now,
            actor: 'community',
            kind: 'handle',
            title: result === 'answered' ? '电话核实：老人接听' : '电话核实：无人接听',
            detail: note || undefined,
          })
          if (result === 'answered') {
            // 接通后确认无异常 → 进入回访结案
            next.status = 'follow_up'
            next = pushTimeline(next, { at: now, actor: 'community', kind: 'handle', title: '电话确认老人状态平稳', detail: '转入回访结案流程' })
          }
          const elder = s.elders.find((e) => e.id === ev.elderId)
          return elder ? applyEscalations(next, elder, now) : next
        }),
      }))
    },

    /** 派单上门 */
    dispatchVisit: (eventId, assignee) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId) return ev
          let next: AlertEvent = {
            ...ev,
            status: 'door_visit',
            doorVisit: { dispatchedAt: now, assignee, propertyInvolved: false, usedKeyCustody: false },
          }
          return pushTimeline(next, { at: now, actor: 'community', kind: 'visit', title: '派单网格员上门', detail: `${assignee} 已接单出发` })
        }),
      }))
    },

    recordArrival: (eventId) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.doorVisit) return ev
          let next: AlertEvent = { ...ev, doorVisit: { ...ev.doorVisit, arrivedAt: now } }
          return pushTimeline(next, { at: now, actor: 'community', kind: 'visit', title: '网格员到达老人家门口' })
        }),
      }))
    },

    /** 上门结果 */
    recordVisitResult: (eventId, result, note) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.doorVisit) return ev
          let next: AlertEvent = { ...ev, doorVisit: { ...ev.doorVisit, result, note } }
          const titleMap = { ok: '上门确认老人平安', no_answer: '上门无人开门', need_medical: '上门发现需医疗处置' }
          next = pushTimeline(next, { at: now, actor: 'community', kind: 'visit', title: titleMap[result], detail: note || undefined })
          if (result === 'ok') next.status = 'follow_up'
          if (result === 'need_medical') {
            next.status = 'medical'
            next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: '现场确认需医疗救援' }]
            next = pushTimeline(next, { at: now, actor: 'system', kind: 'escalation', title: '升级：需联动120急救', detail: '网格员现场确认需医疗救援' })
          }
          const elder = s.elders.find((e) => e.id === ev.elderId)
          return elder ? applyEscalations(next, elder, now) : next
        }),
      }))
    },

    /** 联动物业/托管钥匙开门 */
    involveProperty: (eventId, useKey) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId || !ev.doorVisit) return ev
          let next: AlertEvent = { ...ev, doorVisit: { ...ev.doorVisit, propertyInvolved: true, usedKeyCustody: useKey } }
          if (!next.escalations.some((e) => e.kind === 'need_property')) {
            next.escalations = [...next.escalations, { kind: 'need_property', at: now, note: '上门无人开门，联动物业协助入户' }]
          }
          next = pushTimeline(next, {
            at: now,
            actor: 'community',
            kind: 'handle',
            title: useKey ? '联动物业并使用托管钥匙入户' : '联动物业协助开门',
            detail: useKey ? `物业值班 ${DUTY_STAFF[2].name} 到场，使用社区托管备用钥匙` : `物业值班 ${DUTY_STAFF[2].name} 到场协助`,
          })
          return next
        }),
      }))
    },

    /** 呼叫120 */
    call120: (eventId, by) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId) return ev
          let next: AlertEvent = { ...ev, status: 'medical', medical: { called120: true, at: now } }
          if (!next.escalations.some((e) => e.kind === 'need_120')) {
            next.escalations = [...next.escalations, { kind: 'need_120', at: now, note: by === 'community' ? '社区值班员呼叫120' : '家属呼叫120' }]
          }
          return pushTimeline(next, {
            at: now,
            actor: by === 'community' ? 'community' : 'family',
            kind: 'medical',
            title: '呼叫120急救',
            detail: '已同步老人慢病史与用药信息',
          })
        }),
      }))
    },

    /** 记录就医结果 */
    recordMedical: (eventId, hospital, outcome) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId) return ev
          let next: AlertEvent = {
            ...ev,
            status: 'follow_up',
            medical: { called120: ev.medical?.called120 ?? true, at: ev.medical?.at ?? now, hospital, outcome },
          }
          return pushTimeline(next, { at: now, actor: 'medical', kind: 'medical', title: `送医：${hospital}`, detail: outcome })
        }),
      }))
    },

    /** 回访记录 */
    recordFollowUp: (eventId, note) => {
      const now = get().now()
      set((s) => ({
        events: s.events.map((ev) => {
          if (ev.id !== eventId) return ev
          const by = s.session?.userName ?? '值班员'
          let next: AlertEvent = { ...ev, followUp: { at: now, by, note } }
          return pushTimeline(next, { at: now, actor: 'community', kind: 'followup', title: '回访完成', detail: note })
        }),
      }))
    },

    /** 结案：生成复盘报告并沉淀照护画像（低电期间离线的，复盘包含设备维护不及时） */
    closeEvent: (eventId, category, falseReason, summary) => {
      const now = get().now()
      set((s) => {
        const ev = s.events.find((e) => e.id === eventId)
        if (!ev) return s
        const elder = s.elders.find((e) => e.id === ev.elderId)!
        const batteryTask = ev.batteryCareTaskId ? s.batteryTasks.find((t) => t.id === ev.batteryCareTaskId) : undefined
        const deviceMaintenanceNote =
          ev.batteryCareNote ?? (batteryTask ? buildBatteryCareNote(batteryTask, elder, now) : undefined)
        const closure = {
          closedAt: now,
          closedBy: s.session?.userName ?? '值班员',
          category,
          falseReason,
          deviceSuggestion: buildDeviceSuggestion(category, falseReason, ev, elder),
          deviceMaintenanceNote,
          familyResponseMinutes: familyResponseMinutes(ev, now),
          communityHandleMinutes: communityHandleMinutes(ev, now),
          summary,
        }
        let next = pushTimeline(
          { ...ev, status: 'closed', closure },
          {
            at: now,
            actor: 'community',
            kind: 'close',
            title: '事件结案',
            detail: `分类：${CLOSURE_LABEL[category]}${deviceMaintenanceNote ? `；设备维护复盘：${deviceMaintenanceNote}` : ''}`,
          },
        )
        const profile = sedimentProfile(s.profiles[ev.elderId] ?? emptyProfile(ev.elderId, now), next, closure, now)
        return {
          events: s.events.map((e) => (e.id === eventId ? next : e)),
          profiles: { ...s.profiles, [ev.elderId]: profile },
        }
      })
    },

    /** 模拟手环电量上报：进入低电开始计时；恢复充电清空低电并自动闭环任务 */
    reportBattery: (elderId, battery) => {
      const now = get().now()
      set((s) => {
        const elder = s.elders.find((e) => e.id === elderId)
        if (!elder) return s
        const wasLow = elder.battery <= LOW_BATTERY
        const low = battery <= LOW_BATTERY
        const nextElder: Elder = {
          ...elder,
          battery,
          lowBatterySince: low ? (elder.lowBatterySince ?? now) : undefined,
          lastChargedAt: !low && wasLow ? now : elder.lastChargedAt,
        }
        let batteryTasks = s.batteryTasks
        // 电量恢复：自动闭环该老人仍在处理中的低电任务（记录恢复时间，协助人沿用已上门志愿者/家属）
        if (!low && wasLow) {
          batteryTasks = batteryTasks.map((t) => {
            if (t.elderId !== elderId || t.status === 'resolved' || t.status === 'replaced') return t
            const assistedBy = t.volunteerName ?? t.familyReminderName ?? '家属'
            const done: BatteryCareTask = {
              ...t,
              status: 'resolved',
              chargeAssistedBy: assistedBy,
              resolvedAt: now,
              replacementKind: t.replacementKind ?? null,
              replacementNote: t.repeatIndex >= 2 && !t.replacementPrompted ? replacementTip(t.repeatIndex) : t.replacementNote,
              replacementPrompted: t.repeatIndex >= 2 ? true : t.replacementPrompted,
            }
            return pushBatteryRecord(
              done,
              {
                by: '设备',
                action: 'charge_assist',
                note: `手环电量恢复至 ${battery}%，充电协助人：${assistedBy}，恢复时间已登记${
                  t.repeatIndex >= 2 ? '；设备再次低电，系统提示评估更换设备或充电底座' : ''
                }`,
              },
              now,
            )
          })
        }
        return { elders: s.elders.map((e) => (e.id === elderId ? nextElder : e)), batteryTasks }
      })
      // 电量上报后立即检查是否需要新建连续低电任务
      get().tick()
    },

    /** 家属确认已提醒老人充电（但老人仍未充电） */
    familyRemindedCharging: (taskId, note) => {
      const now = get().now()
      const name = get().session?.userName ?? '家属'
      set((s) => ({
        batteryTasks: s.batteryTasks.map((t) => {
          if (t.id !== taskId || t.status !== 'reminding') return t
          let next: BatteryCareTask = {
            ...t,
            status: 'family_reminded',
            familyRemindedAt: now,
            familyReminderName: name,
            familyNote: note,
          }
          next = pushBatteryRecord(
            next,
            { by: name, action: 'family_reminded', note: `家属确认已提醒老人充电，但设备电量仍为 ${t.battery}%，老人仍未充电。${note}` },
            now,
          )
          return next
        }),
      }))
    },

    /** 社区安排志愿者上门协助充电 */
    dispatchVolunteer: (taskId, volunteerId) => {
      const now = get().now()
      set((s) => {
        const task = s.batteryTasks.find((t) => t.id === taskId)
        const elder = s.elders.find((e) => e.id === task?.elderId)
        if (!task || !elder) return s
        if (task.status !== 'family_reminded' && task.status !== 'reminding' && task.status !== 'volunteer_dispatched') return s
        const v: Volunteer = volunteerId
          ? VOLUNTEERS.find((x) => x.id === volunteerId) ?? nearestVolunteer(elder, VOLUNTEERS)
          : nearestVolunteer(elder, VOLUNTEERS)
        return {
          batteryTasks: s.batteryTasks.map((t) => {
            if (t.id !== taskId) return t
            let next: BatteryCareTask = {
              ...t,
              status: 'volunteer_dispatched',
              volunteerId: v.id,
              volunteerName: v.name,
              volunteerPhone: v.phone,
              dispatchedAt: now,
            }
            next = pushBatteryRecord(
              next,
              { by: s.session?.userName ?? '值班员', action: 'volunteer_dispatch', note: `家属确认提醒后老人仍未充电，社区安排${v.name}（${v.phone}，约${v.distanceMin}分钟到达）上门协助充电并检查老人状态` },
              now,
            )
            return next
          }),
        }
      })
    },

    /** 记录志愿者已上门 */
    recordVolunteerArrival: (taskId, note) => {
      const now = get().now()
      set((s) => ({
        batteryTasks: s.batteryTasks.map((t) => {
          if (t.id !== taskId || t.status !== 'volunteer_dispatched') return t
          let next: BatteryCareTask = { ...t, status: 'volunteer_arrived', arrivedAt: now }
          next = pushBatteryRecord(next, { by: t.volunteerName ?? '志愿者', action: 'volunteer_arrive', note: note || '志愿者已上门，查看老人状态并协助充电' }, now)
          return next
        }),
      }))
    },

    /** 低电处理完成：登记充电协助人与恢复时间 */
    resolveBatteryTask: (taskId, assistedBy, note) => {
      const now = get().now()
      set((s) => {
        const task = s.batteryTasks.find((t) => t.id === taskId)
        if (!task || task.status === 'resolved' || task.status === 'replaced') return s
        const elder = s.elders.find((e) => e.id === task.elderId)
        const repeat = task.repeatIndex
        let nextTask: BatteryCareTask = {
          ...task,
          status: 'resolved',
          chargeAssistedBy: assistedBy,
          resolvedAt: now,
          replacementKind: task.replacementKind ?? null,
          replacementNote: repeat >= 2 ? replacementTip(repeat) : task.replacementNote,
          replacementPrompted: repeat >= 2 ? true : task.replacementPrompted,
        }
        nextTask = pushBatteryRecord(
          nextTask,
          {
            by: assistedBy,
            action: 'charge_assist',
            note: `充电协助人：${assistedBy}；恢复时间：${new Date(now).toLocaleString('zh-CN')}。${note}${
              repeat >= 2 ? '；设备再次低电，系统提示评估更换设备或充电底座' : ''
            }`,
          },
          now,
        )
        const batteryTasks = s.batteryTasks.map((t) => (t.id === taskId ? nextTask : t))
        // 设备恢复满电状态，清空连续低电计时（低电风险已在建单时沉淀画像，闭环不再重复计数）
        const elders = elder
          ? s.elders.map((e) => (e.id === elder.id ? { ...e, battery: Math.max(e.battery, 100), lowBatterySince: undefined, lastChargedAt: now } : e))
          : s.elders
        return { batteryTasks, elders }
      })
    },

    /** 再次低电：登记更换设备或充电底座 */
    decideReplacement: (taskId, kind, note) => {
      const now = get().now()
      set((s) => {
        const task = s.batteryTasks.find((t) => t.id === taskId)
        if (!task) return s
        let next: BatteryCareTask = {
          ...task,
          status: 'replaced',
          replacementDecided: true,
          replacementKind: kind,
          replacementNote: note || (kind === 'charger' ? '更换充电底座（疑似接触不良）' : '更换整只手环'),
          resolvedAt: task.resolvedAt ?? now,
          chargeAssistedBy: task.chargeAssistedBy ?? s.session?.userName ?? '社区',
        }
        next = pushBatteryRecord(
          next,
          {
            by: s.session?.userName ?? '值班员',
            action: 'replace_device',
            note: `设备反复低电（第 ${task.repeatIndex} 次），登记${kind === 'charger' ? '更换充电底座' : '更换设备'}：${next.replacementNote}`,
          },
          now,
        )
        // 新设备/新底座视为电量恢复，清空连续低电计时，避免重复建单
        const elders = s.elders.map((e) => (e.id === task.elderId ? { ...e, battery: 100, lowBatterySince: undefined, lastChargedAt: now } : e))
        return { batteryTasks: s.batteryTasks.map((t) => (t.id === taskId ? next : t)), elders }
      })
    },

    updateThresholds: (elderId, t) =>
      set((s) => ({ elders: s.elders.map((e) => (e.id === elderId ? { ...e, thresholds: t } : e)) })),
    updateWearingHabit: (elderId, habit) =>
      set((s) => ({ elders: s.elders.map((e) => (e.id === elderId ? { ...e, wearingHabit: habit } : e)) })),
    updateStrategy: (elderId, strategy) =>
      set((s) => {
        const p = s.profiles[elderId] ?? emptyProfile(elderId, s.now())
        return { profiles: { ...s.profiles, [elderId]: { ...p, strategy, updatedAt: s.now() } } }
      }),
  }
})

export { GRID_WORKERS, VOLUNTEERS, nearestWorker, nearestVolunteer }
