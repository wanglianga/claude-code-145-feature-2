/* 端到端流程验证脚本：模拟一次完整告警处置闭环（esbuild 打包后由 node 执行） */
import { useStore } from '../src/store/useStore'

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

// 9. 设备低电照护风险：连续两天低电未充电自动建单（周淑珍 e5，初始电量 83%）
check('初始无 e5 低电照护任务', s().batteryTasks.every((t) => t.elderId !== 'e5'))
s().reportBattery('e5', 15)
check('刚上报低电（未满两天）不建照护任务', s().batteryTasks.every((t) => t.elderId !== 'e5'))
s().fastForward(2 * 24 * 60) // 演示时间快进 2 天
const t1 = s().batteryTasks.find((t) => t.elderId === 'e5' && t.status !== 'resolved' && t.status !== 'replaced')!
check('连续两天低电自动建立照护任务', !!t1)
check('新任务待家属确认', t1?.status === 'reminding')
check('首次连续低电 repeatIndex=1', t1?.repeatIndex === 1)
check('风险提示依据佩戴习惯（女儿协助充电）', t1?.riskTips.some((x) => x.includes('协助')) === true)
check('风险提示包含上门查看老人状态', t1?.riskTips.some((x) => x.includes('老人本人状态')) === true)
check('低电风险建单即沉淀画像', s().profiles['e5'].lowBatteryCount === 1)
check('画像生成连续低电标签', s().profiles['e5'].riskTags.some((x) => x.includes('连续低电')) === true)

// 10. 低电期间发生离线告警 → 关联低电任务并纳入复盘
s().raiseAlert('e5', 'offline', '—（设备离线）')
const evO = s().events[0]
check('离线事件关联低电照护任务', evO.batteryCareTaskId === t1.id)
check('离线事件触发“设备维护不及时”升级', evO.escalations.some((e) => e.kind === 'battery_unmaintained'))
check('处置流程含连续低电照护干预步骤', evO.plan.some((p) => p.key === 'battery_care'))
check('事件时间线记录低电关联', evO.timeline.some((x) => x.kind === 'battery'))

// 11. 家属确认已提醒但老人仍未充电 → 社区安排志愿者
s().familyRemindedCharging(t1.id, '已电话提醒我妈充电，她可能忘了')
const t1b = s().batteryTasks.find((t) => t.id === t1.id)!
check('家属确认已提醒→状态推进', t1b.status === 'family_reminded' && !!t1b.familyRemindedAt)
s().dispatchVolunteer(t1.id)
const t1c = s().batteryTasks.find((t) => t.id === t1.id)!
check('社区已安排志愿者', t1c.status === 'volunteer_dispatched' && !!t1c.volunteerName)
check('志愿者按楼栋就近匹配（2栋→周阿姨）', t1c.volunteerName?.includes('周阿姨') === true)
s().recordVolunteerArrival(t1.id, '老人在家，充电底座插头被碰掉了，已重新插好')
const t1d = s().batteryTasks.find((t) => t.id === t1.id)!
check('志愿者已上门', t1d.status === 'volunteer_arrived' && !!t1d.arrivedAt)

// 12. 离线事件结案：复盘包含设备维护不及时
s().familyRespond(evO.id, 'false_alarm', '人没事，是手环没电关机')
s().recordFollowUp(evO.id, '电话确认老人平安，设备低电问题已安排志愿者处理')
s().closeEvent(evO.id, 'care_gap', undefined, '低电未充电导致离线，属照护缺口，已闭环低电照护任务')
const evO2 = s().events.find((e) => e.id === evO.id)!
check('复盘包含设备维护不及时', (evO2.closure?.deviceMaintenanceNote ?? '').includes('设备维护不及时') === true)
check('设备建议包含低电照护闭环', evO2.closure?.deviceSuggestion.includes('连续低电') === true)
check('画像离线计数+1', s().profiles['e5'].offlineCount === 1)
check('低电计数结案不重复累计', s().profiles['e5'].lowBatteryCount === 1)

// 13. 低电处理完成：记录充电协助人与恢复时间
s().resolveBatteryTask(t1.id, '周阿姨（社区志愿者）', '重新插好充电底座，指导老人每晚睡前充电')
const t1e = s().batteryTasks.find((t) => t.id === t1.id)!
check('低电任务已闭环', t1e.status === 'resolved')
check('已记录充电协助人', t1e.chargeAssistedBy === '周阿姨（社区志愿者）')
check('已记录充电恢复时间', typeof t1e.resolvedAt === 'number')
const e5After = s().elders.find((e) => e.id === 'e5')!
check('设备电量恢复且清空低电计时', e5After.battery === 100 && e5After.lowBatterySince == null)
check('首次低电不提示更换', !t1e.replacementPrompted && !t1e.replacementDecided)

// 14. 设备再次低电 → 提示更换设备或充电底座
s().reportBattery('e5', 10)
s().fastForward(2 * 24 * 60)
const t2 = s().batteryTasks.find((t) => t.elderId === 'e5' && t.status === 'reminding')!
check('再次低电自动建新单且 repeatIndex=2', !!t2 && t2.repeatIndex === 2)
s().familyRemindedCharging(t2.id, '又忘了充')
s().dispatchVolunteer(t2.id)
s().recordVolunteerArrival(t2.id, '底座疑似接触不良')
s().resolveBatteryTask(t2.id, '周阿姨（社区志愿者）', '重新充电，底座疑似接触不良')
const t2b = s().batteryTasks.find((t) => t.id === t2.id)!
check('第2次低电闭环后系统提示更换设备/底座', t2b.replacementPrompted === true && (t2b.replacementNote ?? '').includes('更换') === true)
check('提示阶段尚未登记更换决定', !t2b.replacementDecided)
s().decideReplacement(t2.id, 'charger', '更换充电底座（疑似接触不良），观察一周')
const t2c = s().batteryTasks.find((t) => t.id === t2.id)!
check('已登记更换充电底座', t2c.status === 'replaced' && t2c.replacementDecided === true && t2c.replacementKind === 'charger')

// 15. 种子数据：李建国（e2）连续两天低电、家属已提醒未充电，待社区安排志愿者
const seedTask = s().batteryTasks.find((t) => t.id === 'BC-0001')!
check('种子低电照护任务存在', !!seedTask && seedTask.elderId === 'e2')
check('种子任务为家属已提醒未充电', seedTask.status === 'family_reminded')
check('种子任务 repeatIndex=2（恢复时提示更换）', seedTask.repeatIndex === 2)
check('种子提示依据佩戴习惯生成', seedTask.riskTips.some((x) => x.includes('充电底座')) === true)
check('种子提示包含第2次更换建议', seedTask.riskTips.some((x) => x.includes('第 2 次')) === true)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
