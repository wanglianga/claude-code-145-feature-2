import React, { useState } from 'react'
import { Alert, Button, Card, Col, Empty, Input, Layout, Row, Space, Tag, Typography, message } from 'antd'
import { CheckCircleOutlined, HomeOutlined, LogoutOutlined, MedicineBoxOutlined, PhoneOutlined, SafetyOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useStore } from '../store/useStore'
import { AlertTypeTag, SeverityTag, StatusTag, fmtTime } from '../components/common'
import { LOW_BATTERY, LOW_BATTERY_DAYS, lowBatteryDaysOf } from '../store/workflow'
import ElderInfoCard from '../components/ElderInfoCard'
import EventTimeline from '../components/EventTimeline'

const { Header, Content } = Layout
const { Title, Text } = Typography

/** 家属端门户：确认误报 / 请求电话核实 / 要求上门 / 直接联系急救 */
const FamilyPortalPage: React.FC = () => {
  const session = useStore((s) => s.session)!
  const logout = useStore((s) => s.logout)
  const elders = useStore((s) => s.elders)
  const events = useStore((s) => s.events)
  const familyRespond = useStore((s) => s.familyRespond)
  const batteryTasks = useStore((s) => s.batteryTasks)
  const familyRemindedCharging = useStore((s) => s.familyRemindedCharging)
  const now = useStore((s) => s.now)
  const [notes, setNotes] = useState<Record<string, string>>({})

  const elder = elders.find((e) => e.id === session.elderId)
  const myEvents = events.filter((e) => e.elderId === session.elderId)
  const active = myEvents.filter((e) => e.status !== 'closed')
  const history = myEvents.filter((e) => e.status === 'closed')
  const batteryTask = batteryTasks.find((t) => t.elderId === session.elderId && t.status !== 'resolved' && t.status !== 'replaced')

  if (!elder) return null

  const act = (eventId: string, response: 'false_alarm' | 'request_call' | 'request_visit' | 'called_120') => {
    familyRespond(eventId, response, notes[eventId] ?? '')
    message.success('您的操作已通知社区值班中心')
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px' }}>
        <Space>
          <SafetyOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          <Title level={4} style={{ margin: 0 }}>
            家属端 · {elder.name}的告警确认
          </Title>
          <Tag color="green">{session.userName}</Tag>
        </Space>
        <Button size="small" icon={<LogoutOutlined />} onClick={logout}>
          退出
        </Button>
      </Header>
      <Content style={{ padding: 16, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        <Row gutter={12}>
          <Col xs={24} lg={9}>
            <ElderInfoCard elder={elder} communityView={false} />
          </Col>
          <Col xs={24} lg={15}>
            {batteryTask && (
              <Card
                size="small"
                style={{ marginBottom: 12, borderColor: '#ffa940' }}
                title={
                  <Space wrap>
                    <ThunderboltOutlined style={{ color: '#fa8c16' }} />
                    <Tag color="orange">设备低电照护提醒</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      手环电量 {elder.battery}%，已连续低电 {Math.max(lowBatteryDaysOf(elder, now()), LOW_BATTERY_DAYS)} 天未充电
                    </Text>
                  </Space>
                }
              >
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message={`老人手环连续 ${LOW_BATTERY_DAYS} 天低电且未充电，请尽快提醒老人充电或上门查看`}
                  description={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {batteryTask.riskTips.map((tip, i) => (
                        <li key={i}>
                          <Text style={{ fontSize: 12 }}>{tip}</Text>
                        </li>
                      ))}
                    </ul>
                  }
                />
                {batteryTask.status === 'reminding' && (
                  <>
                    <Input.TextArea
                      rows={2}
                      placeholder="给社区留言（可选），如：已电话提醒/我下班过去看看"
                      style={{ marginBottom: 8 }}
                      value={notes[batteryTask.id] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [batteryTask.id]: e.target.value })}
                    />
                    <Button
                      type="primary"
                      onClick={() => {
                        familyRemindedCharging(batteryTask.id, notes[batteryTask.id] ?? '')
                        message.success('已确认提醒老人。若老人仍未充电，社区可安排志愿者上门协助')
                      }}
                    >
                      我已提醒老人充电
                    </Button>
                  </>
                )}
                {batteryTask.status !== 'reminding' && (
                  <Alert
                    type="info"
                    showIcon
                    message={
                      batteryTask.volunteerName
                        ? `社区已安排志愿者 ${batteryTask.volunteerName}（${batteryTask.volunteerPhone}）上门协助`
                        : '您已确认提醒老人充电，若老人仍未充上，社区将安排志愿者上门协助'
                    }
                    description={batteryTask.familyNote ? `家属留言：${batteryTask.familyNote}` : undefined}
                  />
                )}
              </Card>
            )}
            {elder.battery <= LOW_BATTERY && !batteryTask && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message={`手环电量仅剩 ${elder.battery}%，请提醒老人尽快充电；连续 ${LOW_BATTERY_DAYS} 天未充电时社区会启动上门检查`}
              />
            )}
            {active.length === 0 && !batteryTask && (
              <Card size="small" style={{ marginBottom: 12 }}>
                <Empty description="当前没有待处理的告警，老人状态平稳" />
              </Card>
            )}
            {active.map((ev) => (
              <Card
                key={ev.id}
                size="small"
                style={{ marginBottom: 12, borderColor: '#ff4d4f' }}
                title={
                  <Space wrap>
                    <Tag color="red">新告警</Tag>
                    <AlertTypeTag v={ev.type} />
                    <SeverityTag v={ev.severity} />
                    <StatusTag v={ev.status} />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {fmtTime(ev.occurredAt)} · {ev.location}
                      {ev.isNight && ' · 夜间'}
                    </Text>
                  </Space>
                }
              >
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={`手环上报${ev.location}发生告警，请您尽快确认老人情况`}
                  description="如确认为误报请点击「确认误报」；如需社区协助请选择电话核实或要求上门；紧急情况请直接拨打120。"
                />
                {!ev.family.respondedAt ? (
                  <>
                    <Input.TextArea
                      rows={2}
                      placeholder="给社区值班员留言（可选）"
                      style={{ marginBottom: 8 }}
                      value={notes[ev.id] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [ev.id]: e.target.value })}
                    />
                    <Space wrap>
                      <Button icon={<CheckCircleOutlined />} onClick={() => act(ev.id, 'false_alarm')}>
                        确认误报
                      </Button>
                      <Button icon={<PhoneOutlined />} onClick={() => act(ev.id, 'request_call')}>
                        请求电话核实
                      </Button>
                      <Button type="primary" icon={<HomeOutlined />} onClick={() => act(ev.id, 'request_visit')}>
                        要求上门查看
                      </Button>
                      <Button danger icon={<MedicineBoxOutlined />} onClick={() => act(ev.id, 'called_120')}>
                        直接拨打120
                      </Button>
                    </Space>
                  </>
                ) : (
                  <Alert
                    type="success"
                    showIcon
                    message={`您已于 ${fmtTime(ev.family.respondedAt)} 响应：${
                      { false_alarm: '确认误报', request_call: '请求电话核实', request_visit: '要求上门查看', called_120: '已拨打120' }[ev.family.response!]
                    }，社区正在处置中`}
                  />
                )}
                <div style={{ marginTop: 12 }}>
                  <EventTimeline event={ev} />
                </div>
              </Card>
            ))}

            {history.length > 0 && (
              <Card size="small" title="历史事件">
                {history.map((ev) => (
                  <Card key={ev.id} size="small" type="inner" style={{ marginBottom: 8 }}
                    title={
                      <Space>
                        <AlertTypeTag v={ev.type} />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {fmtTime(ev.occurredAt)}
                        </Text>
                        {ev.closure && (
                          <Tag color={ev.closure.category === 'real_risk' ? 'red' : ev.closure.category === 'care_gap' ? 'orange' : 'default'}>
                            {ev.closure.category === 'real_risk' ? '真实风险' : ev.closure.category === 'care_gap' ? '照护缺口' : '设备误报'}
                          </Tag>
                        )}
                      </Space>
                    }
                  >
                    {ev.closure && (
                      <Text style={{ fontSize: 12 }}>
                        {ev.closure.summary}
                        {ev.closure.falseReason && `（误报原因：${ev.closure.falseReason}）`}
                      </Text>
                    )}
                  </Card>
                ))}
              </Card>
            )}
          </Col>
        </Row>
      </Content>
    </Layout>
  )
}

export default FamilyPortalPage
