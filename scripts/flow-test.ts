/* 端到端流程验证脚本：模拟一次完整告警处置闭环（esbuild 打包后由 node 执行） */
import { useStore } from '../src/store/useStore'
import { buildLowBatteryHints } from '../src/store/workflow'

const s = () => useStore.getState()
let failures = 0
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures++
}

// 1. 发起告警（王秀兰，浴室跌倒）
const before = s().events.length
s().raiseAlert('e1', 'fall', '家-浴室')
const ev1 = s().events[0]
check('新告警已生成', s().events.length === before + 1)
check('浴室跌倒等级为紧急', ev1.severity === 'high')
check('初始状态为待家属确认', ev1.status === 'pending_family')
check('已生成处置流程', ev1.plan.length >= 6)
check('流程含上门与120步骤', ev1.plan.some((p) => p.key === 'door_visit') && ev1.plan.some((p) => p.key === 'call_120'))
check('浴室场景触发升级', ev1.escalations.some((e) => e.kind === 'night_bathroom'))

// 2. 家属超时未响应（快进5分钟）
s().fastForward(5)
const ev2 = s().events.find((e) => e.id === ev1.id)!
check('家属超时升级已触发', ev2.escalations.some((e) => e.kind === 'family_timeout'))
check('家属标记为超时', ev2.family.timedOut)

// 3. 电话核实两次无人接 → 升级
s().recordPhoneAttempt(ev1.id, 'no_answer', '响铃30秒无人接')
s().recordPhoneAttempt(ev1.id, 'no_answer', '')
const ev3 = s().events.find((e) => e.id === ev1.id)!
check('电话无人接升级已触发', ev3.escalations.some((e) => e.kind === 'phone_no_answer'))

// 4. 家属要求上门
s().familyRespond(ev1.id, 'request_visit', '我在外地，请社区上门')
const ev4 = s().events.find((e) => e.id === ev1.id)!
check('家属响应已记录', ev4.family.response === 'request_visit')
check('状态转为上门处置', ev4.status === 'door_visit')

// 5. 派单 → 到达 → 无人开门 → 物业+钥匙 → 需就医
s().dispatchVisit(ev1.id, '刘敏')
s().recordArrival(ev1.id)
s().recordVisitResult(ev1.id, 'no_answer', '敲门5分钟无人应答')
const ev5 = s().events.find((e) => e.id === ev1.id)!
check('上门无人开门升级已触发', ev5.escalations.some((e) => e.kind === 'door_no_answer'))
s().involveProperty(ev1.id, true)
const ev5b = s().events.find((e) => e.id === ev1.id)!
check('物业与托管钥匙已联动', ev5b.doorVisit?.propertyInvolved === true && ev5b.doorVisit?.usedKeyCustody === true)
s().recordVisitResult(ev1.id, 'need_medical', '老人浴室滑倒，无法起身')
const ev6 = s().events.find((e) => e.id === ev1.id)!
check('状态转为就医中', ev6.status === 'medical')
check('需联动120升级已触发', ev6.escalations.some((e) => e.kind === 'need_120'))

// 6. 120 → 就医 → 回访 → 结案
s().call120(ev1.id, 'community')
s().recordMedical(ev1.id, '区人民医院骨科', '软组织挫伤，无骨折，当日返家')
const ev7 = s().events.find((e) => e.id === ev1.id)!
check('就医后转回访', ev7.status === 'follow_up' && ev7.medical?.hospital === '区人民医院骨科')
s().recordFollowUp(ev1.id, '电话回访，老人已返家休养')
s().closeEvent(ev1.id, 'real_risk', undefined, '浴室滑倒真实风险，处置链条完整，建议加装防滑设施')
const ev8 = s().events.find((e) => e.id === ev1.id)!
check('事件已结案', ev8.status === 'closed')
check('复盘含家属响应时长', typeof ev8.closure?.familyResponseMinutes === 'number')
check('复盘含社区处置时效', (ev8.closure?.communityHandleMinutes ?? 0) > 0)
check('复盘含设备建议', (ev8.closure?.deviceSuggestion ?? '').length > 0)
check('时间线覆盖告警到结案全流程', ['alert', 'confirm', 'visit', 'medical', 'followup', 'close'].every((k) => ev8.timeline.some((t) => t.kind === k)))

// 7. 照护画像沉淀
const p = s().profiles['e1']
check('画像真实风险+1', p.realRiskCount === 1)
check('画像家属未响应+1', p.familyTimeoutCount === 1)
check('画像上门无人+1', p.doorNoAnswerCount === 1)
check('画像标签已生成', p.riskTags.some((t) => t.includes('真实风险')) && p.riskTags.some((t) => t.includes('上门无人')))
check('照护策略已生成', p.strategy.visitFrequency.length > 0 && p.strategy.familyReminder.length > 0)

// 8. 误报结案路径（张桂芳 静止误报）
const e3FalseBefore = s().profiles['e3'].falseAlarmCount
s().raiseAlert('e3', 'stillness', '家-客厅')
const evB = s().events[0]
s().familyRespond(evB.id, 'false_alarm', '老人看电视久坐，手环误报')
s().recordFollowUp(evB.id, '电话回访确认无恙')
s().closeEvent(evB.id, 'device_false', '静止阈值过低（看书/看电视久坐）', '久坐误判，建议上调静止阈值')
const evB2 = s().events.find((e) => e.id === evB.id)!
check('误报结案分类正确', evB2.closure?.category === 'device_false')
check('误报建议针对阈值', evB2.closure?.deviceSuggestion.includes('静止阈值') === true)
check('画像误报计数+1', s().profiles['e3'].falseAlarmCount === e3FalseBefore + 1)

// 9. 种子数据：李建国连续两天低电未充电工单
const e2 = s().elders.find((x) => x.id === 'e2')!
check('李建国设备当前低电（15%）', e2.battery === 15)
const bc0 = s().batteryEpisodes.find((x) => x.id === 'BC-2001')!
check('存在连续两天低电工单 BC-2001', !!bc0 && bc0.lowDays === 2)
check('家属已确认提醒老人', !!bc0.familyRemindedAt && bc0.status === 'family_reminded')
const hints = buildLowBatteryHints(e2, 2, 1)
check('风险提示结合佩戴习惯', hints.some((h) => h.includes('全天佩戴')))
check('风险提示结合历史告警', hints.some((h) => h.includes('历史误报')))
check('风险提示低电期间离线盲区', hints.some((h) => h.includes('离线告警')))
check('风险提示上门检查', hints.some((h) => h.includes('立即上门检查')))
const evOffline = s().events.find((x) => x.id === 'EV-1003')!
check('离线事件关联低电工单', evOffline.batteryEpisodeId === 'BC-2001')
check('离线事件已标记维护不及时升级', evOffline.escalations.some((x) => x.kind === 'maintenance_delayed'))

// 10. 家属确认已提醒但老人仍未充电 → 请求志愿者
s().requestVolunteer('BC-2001', '提醒了但老人没充，请求志愿者帮忙')
const bc1 = s().batteryEpisodes.find((x) => x.id === 'BC-2001')!
check('工单标记提醒后仍未充电', bc1.familyStillNotCharging === true)
check('社区可安排志愿者（建议上门状态）', bc1.status === 'visit_suggested')

// 11. 社区安排志愿者上门协助充电
s().assignVolunteer('BC-2001')
const bc2 = s().batteryEpisodes.find((x) => x.id === 'BC-2001')!
check('志愿者已安排', bc2.status === 'volunteer_assigned' && !!bc2.chargeAssist)
check('就近匹配5栋志愿者小马', bc2.chargeAssist!.volunteerName.includes('小马'))
s().recordVolunteerArrival('BC-2001')
s().recordChargeAssist('BC-2001', 'charged', '充电底座触点偏移，已协助对准充上电')
const bc3 = s().batteryEpisodes.find((x) => x.id === 'BC-2001')!
check('志愿者到达与结果已记录', !!bc3.chargeAssist?.arrivedAt && bc3.chargeAssist.result === 'charged')

// 12. 完成低电处理：记录充电协助人与恢复时间
const profileBefore = s().profiles['e2'].lowBatteryCount
s().resolveBatteryCare('BC-2001', '小马（社区志愿者）', 'volunteer', '协助对准充电底座，恢复充电', 88)
const bc4 = s().batteryEpisodes.find((x) => x.id === 'BC-2001')!
check('低电工单已闭环', bc4.status === 'resolved')
check('已记录充电协助人', bc4.resolution?.helperName === '小马（社区志愿者）')
check('已记录恢复时间与恢复电量', !!bc4.resolution?.recoveredAt && bc4.resolution.batteryAfter === 88)
check('画像低电照护计数+1', s().profiles['e2'].lowBatteryCount === profileBefore + 1)
check('画像志愿者协助计数+1', s().profiles['e2'].chargeAssistCount >= 2)

// 13. 低电期间离线告警结案 → 事件复盘含设备维护不及时
s().closeEvent('EV-1003', 'care_gap', undefined, '低电耗尽导致离线，网格员上门老人平安，认定设备维护不及时')
const evOfflineClosed = s().events.find((x) => x.id === 'EV-1003')!
check('离线事件已结案', evOfflineClosed.status === 'closed')
check('复盘认定设备维护不及时', evOfflineClosed.closure?.maintenanceReview?.delayed === true)
check('复盘含维护不及时说明', (evOfflineClosed.closure?.maintenanceReview?.detail ?? '').includes('维护不及时'))
check('画像维护不及时计数+1', s().profiles['e2'].maintenanceDelayedCount === 1)
check('画像生成维护不及时标签', s().profiles['e2'].riskTags.includes('设备维护不及时'))
check('画像策略升级为每日跟踪电量', s().profiles['e2'].strategy.deviceMaintenance.includes('每日跟踪电量'))

// 14. 设备再次低电 → 系统提示更换设备/充电底座
s().reportBattery('e2', 12, 'device')
const newEp = s().batteryEpisodes.find((x) => x.elderId === 'e2' && x.status !== 'resolved' && x.status !== 'replacement')!
check('再次低电自动新建工单', !!newEp && newEp.id !== 'BC-2001')
check('新工单关联上一次低电记录', newEp.replacement?.relatedEpisodeId === 'BC-2001')
s().decideReplacement(newEp.id, 'dock', '上门确认为充电底座触点老化，更换充电底座')
const newEp2 = s().batteryEpisodes.find((x) => x.id === newEp.id)!
check('已登记更换充电底座', newEp2.status === 'replacement' && newEp2.replacement?.option === 'dock')

// 15. 首日低电 → 快进跨天自动升级为建议上门；低电期间再发离线告警
s().reportBattery('e4', 14, 'device')
const ep4 = s().batteryEpisodes.find((x) => x.elderId === 'e4' && x.status === 'monitoring')!
check('首日低电进入观察并自动推送家属', !!ep4 && ep4.lowDays === 1 && ep4.reminders.some((r) => r.kind === 'auto_notice'))
s().fastForward(1440)
const ep4b = s().batteryEpisodes.find((x) => x.id === ep4.id)!
check('连续两天低电自动升级建议上门', ep4b.lowDays === 2 && ep4b.status === 'visit_suggested')
s().raiseAlert('e4', 'offline', '—（设备离线）')
const evNew = s().events[0]
check('低电期间新离线事件关联工单', evNew.elderId === 'e4' && evNew.batteryEpisodeId === ep4.id)
check('新离线事件触发维护不及时升级', evNew.escalations.some((x) => x.kind === 'maintenance_delayed'))
check('工单累计离线告警', s().batteryEpisodes.find((x) => x.id === ep4.id)!.offlineAlertIds.includes(evNew.id))

// 16. 电量恢复自动闭环
s().reportBattery('e4', 90, 'device')
const ep4c = s().batteryEpisodes.find((x) => x.id === ep4.id)!
check('电量回升自动闭环工单', ep4c.status === 'resolved' && ep4c.resolution?.batteryAfter === 90)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
