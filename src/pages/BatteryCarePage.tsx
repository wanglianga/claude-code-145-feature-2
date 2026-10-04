import React, { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd'
import { SwapOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useStore, VOLUNTEERS } from '../store/useStore'
import { BatteryCareRecord, BatteryCareTask, BATTERY_TASK_STATUS_LABEL } from '../types'
import { LOW_BATTERY, LOW_BATTERY_DAYS, lowBatteryDaysOf, nearestVolunteer } from '../store/workflow'
import { fmtTime, fmtTimeFull } from '../components/common'

const { Text } = Typography

const STATUS_COLOR: Record<BatteryCareTask['status'], string> = {
  reminding: 'gold',
  family_reminded: 'orange',
  volunteer_dispatched: 'processing',
  volunteer_arrived: 'blue',
  resolved: 'green',
  replaced: 'default',
}

const RECORD_LABEL: Record<BatteryCareRecord['action'], string> = {
  detect: '系统识别风险',
  family_reminded: '家属确认已提醒',
  volunteer_dispatch: '安排志愿者',
  volunteer_arrive: '志愿者上门',
  charge_assist: '充电恢复',
  replace_device: '更换设备/底座',
  family_dismiss: '家属已处理',
}

/** 低电照护：连续两天低电未充电的风险提示 → 家属确认 → 志愿者协助 → 恢复登记 → 反复低电更换提示 */
const BatteryCarePage: React.FC = () => {
  const elders = useStore((s) => s.elders)
  const tasks = useStore((s) => s.batteryTasks)
  const profiles = useStore((s) => s.profiles)
  const now = useStore((s) => s.now)
  const familyRemindedCharging = useStore((s) => s.familyRemindedCharging)
  const dispatchVolunteer = useStore((s) => s.dispatchVolunteer)
  const recordVolunteerArrival = useStore((s) => s.recordVolunteerArrival)
  const resolveBatteryTask = useStore((s) => s.resolveBatteryTask)
  const decideReplacement = useStore((s) => s.decideReplacement)
  const reportBattery = useStore((s) => s.reportBattery)

  const [familyModal, setFamilyModal] = useState<BatteryCareTask | null>(null)
  const [volunteerModal, setVolunteerModal] = useState<BatteryCareTask | null>(null)
  const [arriveModal, setArriveModal] = useState<BatteryCareTask | null>(null)
  const [resolveModal, setResolveModal] = useState<BatteryCareTask | null>(null)
  const [replaceModal, setReplaceModal] = useState<BatteryCareTask | null>(null)
  const [familyNote, setFamilyNote] = useState('')
  const [volunteerId, setVolunteerId] = useState<string | undefined>(undefined)
  const [arriveNote, setArriveNote] = useState('')
  const [assistedBy, setAssistedBy] = useState('')
  const [resolveNote, setResolveNote] = useState('')
  const [simElder, setSimElder] = useState<string | undefined>(undefined)

  const elderById = useMemo(() => Object.fromEntries(elders.map((e) => [e.id, e])), [elders])

  const active = tasks.filter((t) => t.status !== 'resolved' && t.status !== 'replaced')
  const history = tasks.filter((t) => t.status === 'resolved' || t.status === 'replaced')
  const lowNow = elders.filter((e) => e.battery <= LOW_BATTERY)

  const openVolunteer = (t: BatteryCareTask) => {
    const elder = elderById[t.elderId]
    setVolunteerId(elder ? nearestVolunteer(elder, VOLUNTEERS).id : VOLUNTEERS[0]?.id)
    setVolunteerModal(t)
  }

  const openResolve = (t: BatteryCareTask) => {
    setAssistedBy(t.volunteerName ?? t.familyReminderName ?? '')
    setResolveNote('')
    setResolveModal(t)
  }

  return (
    <div>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="设备低电导致的照护风险"
        description={
          <Space direction="vertical" size={2}>
            <Text>
              手环电量 ≤{LOW_BATTERY}% 且连续 {LOW_BATTERY_DAYS} 天未充电时，系统根据老人
              <Text strong>佩戴习惯与历史告警</Text>提示家属或社区上门检查；家属确认已提醒但老人仍未充电的，社区可安排志愿者协助。低电期间若发生离线告警，设备维护不及时将自动写入事件复盘。
            </Text>
            <Text type="secondary">处理完成后记录充电协助人与恢复时间；设备再次低电（同一老人第 2 次及以上）时，系统提示是否更换设备或充电底座。</Text>
          </Space>
        }
      />

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="低电照护进行中" value={active.length} prefix={<ThunderboltOutlined />} valueStyle={{ color: active.length ? '#fa8c16' : undefined }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="当前低电设备" value={lowNow.length} suffix={`/ ${elders.length}`} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="已闭环低电照护" value={history.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" title={<Text style={{ fontSize: 12 }}>模拟手环电量上报</Text>}>
            <Space wrap>
              <Select
                size="small"
                style={{ width: 150 }}
                placeholder="选择老人"
                value={simElder}
                onChange={setSimElder}
                options={elders.map((e) => ({ value: e.id, label: `${e.name}（${e.battery}%）` }))}
              />
              <Button size="small" disabled={!simElder} onClick={() => simElder && (reportBattery(simElder, 12), message.success('已上报低电量 12%'))}>
                上报 12%
              </Button>
              <Button
                size="small"
                type="primary"
                disabled={!simElder}
                onClick={() => simElder && (reportBattery(simElder, 100), message.success('已上报充电恢复 100%，低电任务自动闭环'))}
              >
                充电恢复 100%
              </Button>
            </Space>
          </Card>
        </Col>
      </Row>

      {active.map((t) => {
        const elder = elderById[t.elderId]
        if (!elder) return null
        const days = lowBatteryDaysOf(elder, now())
        return (
          <Card
            key={t.id}
            size="small"
            style={{ marginBottom: 12, borderColor: '#ffa940' }}
            title={
              <Space wrap>
                <ThunderboltOutlined style={{ color: '#fa8c16' }} />
                <span>{elder.name} · 设备低电照护任务 {t.id}</span>
                <Tag color={STATUS_COLOR[t.status]}>{BATTERY_TASK_STATUS_LABEL[t.status]}</Tag>
                <Tag color={t.repeatIndex >= 2 ? 'red' : 'default'}>第 {t.repeatIndex} 次连续低电</Tag>
              </Space>
            }
            extra={
              <Space>
                <Progress type="circle" percent={elder.battery} size={48} status="exception" format={(p) => `${p}%`} />
              </Space>
            }
          >
            <Row gutter={12}>
              <Col xs={24} lg={14}>
                <Descriptions column={2} size="small" bordered>
                  <Descriptions.Item label="设备编号">{t.deviceId}</Descriptions.Item>
                  <Descriptions.Item label="佩戴习惯">{elder.wearingHabit}</Descriptions.Item>
                  <Descriptions.Item label="连续低电起始">{fmtTime(t.lowSince)}（已 {Math.max(days, LOW_BATTERY_DAYS)} 天）</Descriptions.Item>
                  <Descriptions.Item label="系统识别时间">{fmtTime(t.detectedAt)}</Descriptions.Item>
                  <Descriptions.Item label="第一联系人">
                    {[...elder.contacts].sort((a, b) => a.priority - b.priority)[0].name}（
                    {[...elder.contacts].sort((a, b) => a.priority - b.priority)[0].phone}）
                  </Descriptions.Item>
                  <Descriptions.Item label="历史离线/误报">
                    离线 {profiles[elder.id]?.offlineCount ?? 0} 次 · 误报 {elder.historyFalseAlarms} 次
                  </Descriptions.Item>
                  {t.familyRemindedAt && (
                    <Descriptions.Item label="家属确认" span={2}>
                      {fmtTime(t.familyRemindedAt)} · {t.familyReminderName}：{t.familyNote}
                    </Descriptions.Item>
                  )}
                  {t.volunteerName && (
                    <Descriptions.Item label="志愿者" span={2}>
                      {t.volunteerName} {t.volunteerPhone}
                      {t.dispatchedAt ? ` · ${fmtTime(t.dispatchedAt)} 已安排` : ''}
                      {t.arrivedAt ? ` · ${fmtTime(t.arrivedAt)} 已上门` : ''}
                    </Descriptions.Item>
                  )}
                </Descriptions>

                <Alert
                  style={{ marginTop: 8 }}
                  type="warning"
                  showIcon
                  message="根据佩戴习惯与历史告警生成的上门检查提示"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {t.riskTips.map((tip, i) => (
                        <li key={i}>
                          <Text style={{ fontSize: 12 }}>{tip}</Text>
                        </li>
                      ))}
                    </ul>
                  }
                />

                <Space wrap style={{ marginTop: 8 }}>
                  {t.status === 'reminding' && (
                    <>
                      <Button type="primary" onClick={() => setFamilyModal(t)}>
                        家属确认：已提醒老人充电
                      </Button>
                      <Button onClick={() => openVolunteer(t)}>社区直接安排志愿者</Button>
                    </>
                  )}
                  {t.status === 'family_reminded' && (
                    <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => openVolunteer(t)}>
                      老人仍未充电 · 安排志愿者上门协助
                    </Button>
                  )}
                  {t.status === 'volunteer_dispatched' && <Button type="primary" onClick={() => setArriveModal(t)}>记录志愿者已上门</Button>}
                  {t.status === 'volunteer_arrived' && (
                    <Button type="primary" onClick={() => openResolve(t)}>
                      登记充电协助完成（协助人/恢复时间）
                    </Button>
                  )}
                </Space>
              </Col>
              <Col xs={24} lg={10}>
                <Card size="small" type="inner" title="处置记录">
                  <Timeline
                    items={[...t.records]
                      .sort((a, b) => a.at - b.at)
                      .map((r) => ({
                        color: r.action === 'charge_assist' ? 'green' : r.action.startsWith('volunteer') ? 'blue' : 'orange',
                        children: (
                          <div>
                            <Text strong style={{ fontSize: 12 }}>
                              {RECORD_LABEL[r.action]}
                            </Text>{' '}
                            <Tag>{r.by}</Tag>
                            <div>
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                {fmtTime(r.at)}
                                {r.note ? ` · ${r.note}` : ''}
                              </Text>
                            </div>
                          </div>
                        ),
                      }))}
                  />
                </Card>
              </Col>
            </Row>
          </Card>
        )
      })}

      {active.length === 0 && (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Text type="secondary">当前没有进行中的低电照护任务（可使用右上角「模拟手环电量上报」：上报 12% 后用顶栏「演示时间快进」快进 2 天，系统即自动建单）。</Text>
        </Card>
      )}

      <Card size="small" title="已闭环的低电照护（充电协助人 · 恢复时间 · 更换记录）">
        {history.length === 0 && <Text type="secondary">暂无</Text>}
        {history.map((t) => {
          const elder = elderById[t.elderId]
          return (
            <Card
              key={t.id}
              size="small"
              type="inner"
              style={{ marginBottom: 8 }}
              title={
                <Space wrap>
                  <span>{elder?.name ?? t.elderId}</span>
                  <Tag color={STATUS_COLOR[t.status]}>{BATTERY_TASK_STATUS_LABEL[t.status]}</Tag>
                  <Tag color={t.repeatIndex >= 2 ? 'red' : 'default'}>第 {t.repeatIndex} 次</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t.id}
                  </Text>
                </Space>
              }
              extra={
                t.status === 'resolved' && t.repeatIndex >= 2 && !t.replacementDecided ? (
                  <Button size="small" danger icon={<SwapOutlined />} onClick={() => setReplaceModal(t)}>
                    登记更换设备/充电底座
                  </Button>
                ) : undefined
              }
            >
              <Descriptions column={1} size="small">
                <Descriptions.Item label="充电协助人">{t.chargeAssistedBy ?? '—'}</Descriptions.Item>
                <Descriptions.Item label="充电恢复时间">{t.resolvedAt ? fmtTimeFull(t.resolvedAt) : '—'}</Descriptions.Item>
                {t.replacementPrompted && !t.replacementDecided && (
                  <Descriptions.Item label="更换提示">
                    <Text type="warning">{t.replacementNote ?? '设备再次低电，建议评估更换设备或充电底座'}</Text>
                  </Descriptions.Item>
                )}
                {t.replacementDecided && (
                  <Descriptions.Item label="更换登记">
                    <Tag color="red">{t.replacementKind === 'charger' ? '已更换充电底座' : '已更换设备'}</Tag>
                    {t.replacementNote}
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Card>
          )
        })}
      </Card>

      {/* 家属确认已提醒 */}
      <Modal
        title="家属确认：已提醒老人充电"
        open={!!familyModal}
        onCancel={() => setFamilyModal(null)}
        onOk={() => {
          if (familyModal) {
            familyRemindedCharging(familyModal.id, familyNote || '已电话提醒老人充电')
            message.success('已记录。若老人仍未充电，社区将安排志愿者上门协助')
          }
          setFamilyModal(null)
          setFamilyNote('')
        }}
      >
        <Text type="secondary">适用于家属已电话/上门提醒过老人，但老人仍未完成充电的情形。</Text>
        <Input.TextArea rows={3} style={{ marginTop: 8 }} placeholder="家属说明（如：提醒过了，老人说不会用充电底座）" value={familyNote} onChange={(e) => setFamilyNote(e.target.value)} />
      </Modal>

      {/* 安排志愿者 */}
      <Modal
        title="安排志愿者上门协助充电并检查老人状态"
        open={!!volunteerModal}
        onCancel={() => setVolunteerModal(null)}
        onOk={() => {
          if (volunteerModal) {
            dispatchVolunteer(volunteerModal.id, volunteerId)
            message.success('志愿者已派单')
          }
          setVolunteerModal(null)
        }}
      >
        <Form layout="vertical">
          <Form.Item label="协助志愿者（默认按楼栋就近匹配）">
            <Select value={volunteerId} onChange={setVolunteerId} options={VOLUNTEERS.map((v) => ({ value: v.id, label: `${v.name}（${v.phone}，负责${v.buildings.join('/')}，约${v.distanceMin}分钟）` }))} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 志愿者到达 */}
      <Modal
        title="记录志愿者已上门"
        open={!!arriveModal}
        onCancel={() => setArriveModal(null)}
        onOk={() => {
          if (arriveModal) recordVolunteerArrival(arriveModal.id, arriveNote)
          setArriveModal(null)
          setArriveNote('')
          message.success('已记录志愿者上门')
        }}
      >
        <Input.TextArea rows={3} placeholder="现场情况（老人状态、未充电原因、是否已协助充上）" value={arriveNote} onChange={(e) => setArriveNote(e.target.value)} />
      </Modal>

      {/* 登记充电协助完成 */}
      <Modal
        title="低电处理完成：登记充电协助人与恢复时间"
        open={!!resolveModal}
        onCancel={() => setResolveModal(null)}
        onOk={() => {
          if (resolveModal) {
            resolveBatteryTask(resolveModal.id, assistedBy || '志愿者', resolveNote || '已协助老人接通充电底座，手环开始充电')
            message.success('已记录充电协助人与恢复时间，设备电量恢复为 100%')
          }
          setResolveModal(null)
        }}
      >
        <Form layout="vertical">
          <Form.Item label="充电协助人" required>
            <Input value={assistedBy} onChange={(e) => setAssistedBy(e.target.value)} placeholder="如：小马（青年志愿者）/ 刘芳（儿媳）" />
          </Form.Item>
          <Form.Item label="恢复时间">
            <Text>{fmtTimeFull(now())}（登记时刻）</Text>
          </Form.Item>
          <Form.Item label="处理说明">
            <Input.TextArea rows={2} value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="未充电原因、协助方式、对老人的指导" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 更换设备/底座 */}
      <Modal
        title="设备再次低电：是否更换设备或充电底座"
        open={!!replaceModal}
        onCancel={() => setReplaceModal(null)}
        footer={null}
      >
        {replaceModal && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert type="warning" showIcon message={replaceModal.replacementNote || `该设备已是第 ${replaceModal.repeatIndex} 次连续低电，建议先更换充电底座排查接触问题；若仍反复低电则更换整只手环。`} />
            <Space>
              <Button
                type="primary"
                onClick={() => {
                  decideReplacement(replaceModal.id, 'charger', '更换充电底座（疑似接触不良），观察一周电量情况')
                  setReplaceModal(null)
                  message.success('已登记更换充电底座')
                }}
              >
                更换充电底座
              </Button>
              <Button
                danger
                onClick={() => {
                  decideReplacement(replaceModal.id, 'device', '更换整只新手环，旧设备回收检测')
                  setReplaceModal(null)
                  message.success('已登记更换设备')
                }}
              >
                更换整只手环
              </Button>
              <Button onClick={() => setReplaceModal(null)}>暂不更换，继续观察</Button>
            </Space>
          </Space>
        )}
      </Modal>
    </div>
  )
}

export default BatteryCarePage
