import { create } from 'zustand'
import {
  AlertEvent,
  AlertType,
  ALERT_TYPE_LABEL,
  BatteryCareEpisode,
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
import { VOLUNTEERS, DUTY_STAFF, GRID_WORKERS, dutyText, seedElders, seedEvents, seedProfiles } from './seed'
import {
  advanceBatteryEpisode,
  assessSeverity,
  buildDeviceSuggestion,
  buildMaintenanceReview,
  CHARGED_BATTERY,
  checkEscalations,
  communityHandleMinutes,
  dayKey,
  emptyProfile,
  familyResponseMinutes,
  generatePlan,
  isNightTime,
  LOW_BATTERY,
  nearestVolunteer,
  nearestWorker,
  refreshProfile,
  sedimentProfile,
} from './workflow'

let idSeq = 1099
const nextEventId = () => `EV-${++idSeq}`
let episodeSeq = 2099
const nextEpisodeId = () => `BC-${++episodeSeq}`

export interface StoreState {
  session: Session | null
  timeOffset: number // 演示用时间快进（毫秒）
  elders: Elder[]
  events: AlertEvent[]
  batteryEpisodes: BatteryCareEpisode[]
  profiles: Record<string, CareProfile>
  volunteers: Volunteer[]

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

  /** 设备电量上报（手环自动 / 社区手动模拟），自动驱动低电照护工单 */
  reportBattery: (elderId: string, battery: number, source?: 'device' | 'manual') => void
  /** 家属确认已提醒老人充电 */
  ackChargingReminder: (episodeId: string, note: string) => void
  /** 家属提醒后老人仍未充电，请求社区安排志愿者 */
  requestVolunteer: (episodeId: string, note: string) => void
  /** 社区安排志愿者上门协助充电 */
  assignVolunteer: (episodeId: string, volunteerId?: string) => void
  /** 记录志愿者到达 */
  recordVolunteerArrival: (episodeId: string) => void
  /** 记录志愿者上门协助结果 */
  recordChargeAssist: (episodeId: string, result: NonNullable<NonNullable<BatteryCareEpisode['chargeAssist']>['result']>, note: string) => void
  /** 低电处理完成：记录充电协助人与恢复时间，关闭工单 */
  resolveBatteryCare: (
    episodeId: string,
    helperName: string,
    helperRole: 'family' | 'community' | 'volunteer' | 'elder_self',
    note: string,
    batteryAfter?: number,
  ) => void
  /** 再次低电时决定是否更换设备/充电底座 */
  decideReplacement: (episodeId: string, option: 'device' | 'dock' | 'keep', reason: string) => void

  updateThresholds: (elderId: string, t: Thresholds) => void
  updateWearingHabit: (elderId: string, habit: string) => void
  updateStrategy: (elderId: string, strategy: CareProfile['strategy']) => void
}

function pushTimeline(ev: AlertEvent, entry: TimelineEntry): AlertEvent {
  return { ...ev, timeline: [...ev.timeline, entry] }
}

const isEpisodeActive = (ep: BatteryCareEpisode) => ep.status !== 'resolved' && ep.status !== 'replacement'

function applyEscalations(ev: AlertEvent, elder: Elder, now: number, episode?: BatteryCareEpisode): AlertEvent {
  const fresh = checkEscalations(ev, elder, now, episode)
  if (!fresh.length) return ev
  let next = { ...ev, escalations: [...ev.escalations] }
  for (const f of fresh) {
    next.escalations.push({ kind: f.kind, at: now, note: f.note })
    next = pushTimeline(next, { at: now, actor: 'system', kind: 'escalation', title: `升级：${ESCALATION_LABEL[f.kind]}`, detail: f.note })
    if (f.kind === 'family_timeout') next.family = { ...next.family, timedOut: true }
  }
  return next
}

export const useStore = create<StoreState>((set, get) => {
  const boot = Date.now()
  const seeded = seedEvents(boot)
  return {
    session: null,
    timeOffset: 0,
    elders: seedElders(boot),
    events: seeded.events,
    batteryEpisodes: seeded.batteryEpisodes,
    profiles: seedProfiles(boot),
    volunteers: VOLUNTEERS,

    now: () => Date.now() + get().timeOffset,

    login: (role, userName, elderId) => set({ session: { role, userName, elderId } }),
    logout: () => set({ session: null }),

    fastForward: (minutes) => {
      set((s) => ({ timeOffset: s.timeOffset + minutes * 60 * 1000 }))
      get().tick()
    },

    /** 周期性检查：事件升级情形 + 低电照护工单跨天推进 */
    tick: () => {
      const now = get().now()
      set((s) => {
        const episodes = s.batteryEpisodes.map((ep) => {
          const advanced = advanceBatteryEpisode(ep, now)
          if (advanced === ep || advanced.status === ep.status) return advanced
          // 达到连续低电阈值 → 在关联事件上记录升级
          return advanced
        })

        const findEpisode = (elderId: string) =>
          episodes.find((ep) => ep.elderId === elderId && isEpisodeActive(ep))

        const events = s.events.map((ev) => {
          if (ev.status === 'closed') return ev
          const elder = s.elders.find((e) => e.id === ev.elderId)
          if (!elder) return ev
          const episode = ev.batteryEpisodeId
            ? episodes.find((ep) => ep.id === ev.batteryEpisodeId)
            : findEpisode(ev.elderId)
          return applyEscalations(ev, elder, now, episode)
        })

        // 工单升级为建议上门时，补一条系统提醒记录（仅一次）
        const episodes2 = episodes.map((ep) => {
          if (
            ep.status === 'visit_suggested' &&
            !ep.reminders.some((r) => r.kind === 'community_notice')
          ) {
            return {
              ...ep,
              reminders: [
                ...ep.reminders,
                {
                  at: now,
                  by: '系统',
                  role: 'system' as const,
                  kind: 'community_notice' as const,
                  note: `连续 ${ep.lowDays} 天低电未充电，已提示家属并建议社区上门检查`,
                },
              ],
            }
          }
          return ep
        })

        return { events, batteryEpisodes: episodes2 }
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
      const activeEpisode = s.batteryEpisodes.find((ep) => ep.elderId === elderId && isEpisodeActive(ep))
      let ev: AlertEvent = {
        id: nextEventId(),
        elderId,
        type,
        severity,
        location,
        isNight,
        occurredAt: now,
        batteryAtAlert: elder.battery,
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
        }),
        escalations: [],
        family: { contactName: contact.name, contactPhone: contact.phone, notifiedAt: now, timedOut: false },
        phoneAttempts: [],
        batteryEpisodeId: activeEpisode ? activeEpisode.id : undefined,
        timeline: [
          { at: now, actor: 'device', kind: 'alert', title: `手环上报${ALERT_TYPE_LABEL[type]}`, detail: `位置：${location}${isNight ? '，夜间时段' : ''}` },
          { at: now, actor: 'system', kind: 'handle', title: '已通知紧急联系人', detail: `短信+APP推送：${contact.name}（${contact.relation}）${contact.phone}` },
        ],
      }
      ev = applyEscalations(ev, elder, now, activeEpisode)
      set((st) => ({
        events: [ev, ...st.events],
        // 低电期间发生离线告警 → 记入工单，用于复盘
        batteryEpisodes:
          type === 'offline' && activeEpisode && !activeEpisode.offlineAlertIds.includes(ev.id)
            ? st.batteryEpisodes.map((ep) =>
                ep.id === activeEpisode.id
                  ? {
                      ...ep,
                      offlineAlertIds: [...ep.offlineAlertIds, ev.id],
                      samples: [...ep.samples, { at: now, battery: elder.battery, source: 'device' }],
                    }
                  : ep,
              )
            : st.batteryEpisodes,
      }))
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
          const episode = s.batteryEpisodes.find((ep) => ep.id === ev.batteryEpisodeId && isEpisodeActive(ep))
          return elder ? applyEscalations(next, elder, now, episode) : next
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
          const episode = s.batteryEpisodes.find((ep) => ep.id === ev.batteryEpisodeId && isEpisodeActive(ep))
          return elder ? applyEscalations(next, elder, now, episode) : next
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

    /** 结案：生成复盘报告（含设备维护及时性）并沉淀照护画像 */
    closeEvent: (eventId, category, falseReason, summary) => {
      const now = get().now()
      set((s) => {
        const ev = s.events.find((e) => e.id === eventId)
        if (!ev) return s
        const elder = s.elders.find((e) => e.id === ev.elderId)!
        const episode = s.batteryEpisodes.find((ep) => ep.id === ev.batteryEpisodeId)
        const maintenanceReview = buildMaintenanceReview(ev, episode)
        const closure = {
          closedAt: now,
          closedBy: s.session?.userName ?? '值班员',
          category,
          falseReason,
          deviceSuggestion: buildDeviceSuggestion(category, falseReason, ev, elder),
          familyResponseMinutes: familyResponseMinutes(ev, now),
          communityHandleMinutes: communityHandleMinutes(ev, now),
          maintenanceReview,
          summary,
        }
        let next = pushTimeline(
          { ...ev, status: 'closed', closure },
          { at: now, actor: 'community', kind: 'close', title: '事件结案', detail: `分类：${CLOSURE_LABEL[category]}` },
        )
        if (maintenanceReview) {
          next = pushTimeline(next, {
            at: now,
            actor: 'community',
            kind: 'handle',
            title: maintenanceReview.delayed ? '复盘：设备维护不及时' : '复盘：设备维护核查',
            detail: maintenanceReview.detail,
          })
        }
        const profile = sedimentProfile(s.profiles[ev.elderId] ?? emptyProfile(ev.elderId, now), next, closure, now)
        // 低电期间离线事件结案时，同步在工单上留痕
        let episodes = s.batteryEpisodes
        if (episode && maintenanceReview) {
          episodes = episodes.map((ep) =>
            ep.id === episode.id
              ? {
                  ...ep,
                  reminders: [
                    ...ep.reminders,
                    {
                      at: now,
                      by: closure.closedBy,
                      role: 'community' as const,
                      kind: 'community_notice' as const,
                      note: `关联离线事件 ${ev.id} 已结案，复盘${maintenanceReview.delayed ? '认定设备维护不及时' : '核查设备维护'}`,
                    },
                  ],
                }
              : ep,
          )
        }
        return {
          events: s.events.map((e) => (e.id === eventId ? next : e)),
          batteryEpisodes: episodes,
          profiles: { ...s.profiles, [ev.elderId]: profile },
        }
      })
    },

    /** 设备电量上报：维护老人当前电量，自动创建/推进/恢复低电照护工单 */
    reportBattery: (elderId, battery, source = 'manual') => {
      const s = get()
      const elder = s.elders.find((e) => e.id === elderId)
      if (!elder) return
      const now = s.now()
      const active = s.batteryEpisodes.find((ep) => ep.elderId === elderId && isEpisodeActive(ep))

      // 电量恢复 → 若存在低电工单，先更新电量再关闭工单（恢复电量以最新上报为准）
      if (battery > LOW_BATTERY && active) {
        set((st) => ({ elders: st.elders.map((e) => (e.id === elderId ? { ...e, battery } : e)) }))
        get().resolveBatteryCare(
          active.id,
          s.session?.userName ?? (source === 'device' ? '设备自动上报' : '值班员'),
          source === 'device' ? 'elder_self' : 'community',
          `电量恢复至 ${battery}%`,
        )
        return
      }

      if (battery <= LOW_BATTERY && !active) {
        // 再次低电：查找上一次已闭环工单
        const last = [...s.batteryEpisodes]
          .filter((ep) => ep.elderId === elderId && !isEpisodeActive(ep))
          .sort((a, b) => (b.closedAt ?? b.resolution?.at ?? b.startedAt) - (a.closedAt ?? a.resolution?.at ?? a.startedAt))[0]
        const ep: BatteryCareEpisode = {
          id: nextEpisodeId(),
          elderId,
          deviceId: elder.deviceId,
          startedAt: now,
          lowDays: 1,
          lastDayKey: dayKey(now),
          samples: [{ at: now, battery, source }],
          reminders: [
            {
              at: now,
              by: '系统',
              role: 'system',
              kind: 'auto_notice',
              note: `设备电量 ${battery}%，已推送家属充电提醒${last ? `；该设备近期有过一次低电记录（${last.id}）` : ''}`,
            },
          ],
          offlineAlertIds: [],
          status: 'monitoring',
          replacement: last
            ? {
                at: now,
                decidedBy: '待决定',
                option: 'keep',
                reason: '再次低电，待家属/社区确认是否更换设备或充电底座',
                relatedEpisodeId: last.id,
              }
            : undefined,
        }
        set((st) => ({
          elders: st.elders.map((e) => (e.id === elderId ? { ...e, battery } : e)),
          batteryEpisodes: [ep, ...st.batteryEpisodes],
        }))
        return
      }

      // 进行中的工单：追加采样
      if (active) {
        set((st) => ({
          elders: st.elders.map((e) => (e.id === elderId ? { ...e, battery } : e)),
          batteryEpisodes: st.batteryEpisodes.map((ep) =>
            ep.id === active.id ? { ...ep, samples: [...ep.samples, { at: now, battery, source }] } : ep,
          ),
        }))
        return
      }

      // 普通电量刷新
      set((st) => ({ elders: st.elders.map((e) => (e.id === elderId ? { ...e, battery } : e)) }))
    },

    /** 家属确认已提醒老人充电 */
    ackChargingReminder: (episodeId, note) => {
      const now = get().now()
      const by = get().session?.userName ?? '家属'
      set((s) => ({
        batteryEpisodes: s.batteryEpisodes.map((ep) => {
          if (ep.id !== episodeId || !isEpisodeActive(ep) || ep.familyRemindedAt) return ep
          return {
            ...ep,
            status: 'family_reminded',
            familyRemindedAt: now,
            familyStillNotCharging: false,
            reminders: [
              ...ep.reminders,
              { at: now, by, role: 'family', kind: 'family_reminded', note: note || '家属确认已提醒老人充电' },
            ],
          }
        }),
      }))
    },

    /** 家属确认已提醒但老人仍未充电 → 请求社区安排志愿者 */
    requestVolunteer: (episodeId, note) => {
      const now = get().now()
      const by = get().session?.userName ?? '家属'
      set((s) => ({
        batteryEpisodes: s.batteryEpisodes.map((ep) =>
          ep.id === episodeId && isEpisodeActive(ep)
            ? {
                ...ep,
                familyStillNotCharging: true,
                status: 'visit_suggested',
                reminders: [
                  ...ep.reminders,
                  {
                    at: now,
                    by,
                    role: 'family',
                    kind: 'family_reminded',
                    note: note || '家属已提醒但老人仍未充电，请求社区安排志愿者上门协助',
                  },
                ],
              }
            : ep,
        ),
      }))
    },

    /** 社区安排志愿者上门协助充电 */
    assignVolunteer: (episodeId, volunteerId) => {
      const s = get()
      const now = s.now()
      const ep = s.batteryEpisodes.find((e) => e.id === episodeId)
      const elder = s.elders.find((e) => e.id === ep?.elderId)
      if (!ep || !elder) return
      const volunteer =
        s.volunteers.find((v) => v.id === volunteerId) ?? nearestVolunteer(elder, s.volunteers)
      set((st) => ({
        batteryEpisodes: st.batteryEpisodes.map((e) =>
          e.id === episodeId && isEpisodeActive(e)
            ? {
                ...e,
                status: 'volunteer_assigned',
                chargeAssist: { volunteerName: volunteer.name, volunteerPhone: volunteer.phone, assignedAt: now },
                reminders: [
                  ...e.reminders,
                  {
                    at: now,
                    by: st.session?.userName ?? '值班员',
                    role: 'community',
                    kind: 'volunteer_assist',
                    note: `社区已安排志愿者 ${volunteer.name}（${volunteer.phone}，约${volunteer.distanceMin}分钟到达）上门协助充电`,
                  },
                ],
              }
            : e,
        ),
      }))
    },

    recordVolunteerArrival: (episodeId) => {
      const now = get().now()
      set((s) => ({
        batteryEpisodes: s.batteryEpisodes.map((ep) =>
          ep.id === episodeId && ep.chargeAssist && !ep.chargeAssist.arrivedAt
            ? { ...ep, chargeAssist: { ...ep.chargeAssist, arrivedAt: now } }
            : ep,
        ),
      }))
    },

    /** 志愿者上门协助结果（未完成充电时记录原因，不关闭工单） */
    recordChargeAssist: (episodeId, result, note) => {
      const now = get().now()
      set((s) => ({
        batteryEpisodes: s.batteryEpisodes.map((ep) =>
          ep.id === episodeId && ep.chargeAssist
            ? {
                ...ep,
                chargeAssist: { ...ep.chargeAssist, result, note: note || undefined },
                reminders: [
                  ...ep.reminders,
                  {
                    at: now,
                    by: ep.chargeAssist.volunteerName,
                    role: 'volunteer',
                    kind: 'volunteer_assist',
                    note:
                      result === 'charged'
                        ? '志愿者已协助老人充上电'
                        : result === 'elder_refused'
                          ? '老人暂不配合，已耐心沟通'
                          : result === 'device_fault'
                            ? `手环疑似故障：${note || '无法充电'}`
                            : `充电底座疑似故障：${note || '无法供电'}`,
                  },
                ],
              }
            : ep,
        ),
      }))
    },

    /** 低电处理完成：记录充电协助人与恢复时间，关闭工单并沉淀画像 */
    resolveBatteryCare: (episodeId, helperName, helperRole, note, batteryAfterInput) => {
      const s = get()
      const now = s.now()
      const ep = s.batteryEpisodes.find((e) => e.id === episodeId)
      if (!ep || !isEpisodeActive(ep)) return
      const elder = s.elders.find((e) => e.id === ep.elderId)
      const batteryAfter = batteryAfterInput ?? elder?.battery ?? CHARGED_BATTERY
      const recoveredAt = ep.chargeAssist?.arrivedAt ?? now
      const reminders: BatteryCareEpisode['reminders'] = [
        ...ep.reminders,
        {
          at: now,
          by: helperName,
          role: helperRole === 'volunteer' ? 'volunteer' : helperRole === 'family' ? 'family' : helperRole === 'elder_self' ? 'system' : 'community',
          kind: 'volunteer_assist',
          note: `低电处理完成：${note || '设备已恢复充电'}（协助人：${helperName}）`,
        },
      ]
      const resolved: BatteryCareEpisode = {
        ...ep,
        status: 'resolved',
        closedAt: now,
        reminders,
        resolution: { at: now, helperName, helperRole, recoveredAt, batteryAfter, note },
      }
      set((st) => {
        const base = st.profiles[ep.elderId] ?? emptyProfile(ep.elderId, now)
        const profile = refreshProfile(
          {
            ...base,
            lowBatteryCount: base.lowBatteryCount + 1,
            chargeAssistCount: base.chargeAssistCount + (resolved.chargeAssist ? 1 : 0),
          },
          now,
          batteryAfter,
        )
        return {
          elders: batteryAfterInput ? st.elders.map((e) => (e.id === ep.elderId ? { ...e, battery: batteryAfterInput } : e)) : st.elders,
          batteryEpisodes: st.batteryEpisodes.map((e) => (e.id === episodeId ? resolved : e)),
          profiles: { ...st.profiles, [ep.elderId]: profile },
        }
      })
    },

    /** 再次低电：决定更换设备 / 更换充电底座 / 暂不更换 */
    decideReplacement: (episodeId, option, reason) => {
      const s = get()
      const now = s.now()
      const ep = s.batteryEpisodes.find((e) => e.id === episodeId)
      if (!ep || !isEpisodeActive(ep)) return
      const decidedBy = s.session?.userName ?? '值班员'
      set((st) => ({
        batteryEpisodes: st.batteryEpisodes.map((e) =>
          e.id === episodeId
            ? {
                ...e,
                status: option === 'keep' ? e.status : 'replacement',
                closedAt: option === 'keep' ? undefined : now,
                replacement: {
                  at: now,
                  decidedBy,
                  option,
                  reason: reason || (option === 'device' ? '更换手环设备' : option === 'dock' ? '更换充电底座' : '暂不更换，加强充电提醒'),
                  relatedEpisodeId: e.replacement?.relatedEpisodeId,
                },
                reminders: [
                  ...e.reminders,
                  {
                    at: now,
                    by: decidedBy,
                    role: 'community',
                    kind: 'community_notice',
                    note:
                      option === 'device'
                        ? '决定更换手环设备，已登记设备更换工单'
                        : option === 'dock'
                          ? '决定更换充电底座，已安排送装并指导老人使用'
                          : '暂不更换设备/底座，继续加强充电提醒与跟踪',
                  },
                ],
              }
            : e,
        ),
      }))
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

export { GRID_WORKERS, DUTY_STAFF, nearestWorker }
