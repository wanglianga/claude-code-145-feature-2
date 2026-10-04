import React, { useState } from 'react'
import {
  Alert,
  Button,
  Descriptions,
  Input,
  InputNumber,
  Modal,
  Progress,
  Radio,
  Space,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { BatteryCareEpisode, BATTERY_CARE_STATUS_LABEL, Elder } from '../types'
import { buildLowBatteryHints } from '../store/workflow'
import { useStore } from '../store/useStore'
import { fmtTime } from './common'

const { Text, Paragraph } = Typography

const STATUS_COLOR: Record<BatteryCareEpisode['status'], string> = {
  monitoring: 'gold',
  visit_suggested: 'red',
  family_reminded: 'blue',
  volunteer_assigned: 'purple',
  resolved: 'green',
  replacement: 'orange',
}

const ROLE_LABEL: Record<'family' | 'community' | 'system' | 'volunteer' | 'elder_self', string> = {
  family: '家属',
  community: '社区',
  system: '系统',
  volunteer: '志愿者',
  elder_self: '老人自行充电',
}
const RESULT_LABEL = {
  charged: '已协助充上电',
  elder_refused: '老人暂不配合',
  device_fault: '手环设备故障',
  dock_fault: '充电底座故障',
} as const

/** 设备低电照护工单卡片：社区端可处置，家属端可提醒/请求志愿者 */
const BatteryCareCard: React.FC<{
  episode: BatteryCareEpisode
  elder: Elder
  community: boolean
  onOpenEvent?: (eventId: string) => void
}> = ({ episode: ep, elder, community, onOpenEvent }) => {
  const reportBattery = useStore((s) => s.reportBattery)
  const ackChargingReminder = useStore((s) => s.ackChargingReminder)
  const requestVolunteer = useStore((s) => s.requestVolunteer)
  const assignVolunteer = useStore((s) => s.assignVolunteer)
  const recordVolunteerArrival = useStore((s) => s.recordVolunteerArrival)
  const recordChargeAssist = useStore((s) => s.recordChargeAssist)
  const resolveBatteryCare = useStore((s) => s.resolveBatteryCare)
  const decideReplacement = useStore((s) => s.decideReplacement)
  const events = useStore((s) => s.events)

  const [note, setNote] = useState('')
  const [batteryInput, setBatteryInput] = useState<number>(85)
  const [assistModal, setAssistModal] = useState(false)
  const [assistResult, setAssistResult] = useState<NonNullable<NonNullable<BatteryCareEpisode['chargeAssist']>['result']>>('charged')
  const [assistNote, setAssistNote] = useState('')
  const [resolveModal, setResolveModal] = useState(false)
  const [helperName, setHelperName] = useState('')
  const [resolveNote, setResolveNote] = useState('')
  const [recoveredBattery, setRecoveredBattery] = useState<number>(85)
  const [replaceModal, setReplaceModal] = useState(false)
  const [replaceOption, setReplaceOption] = useState<'device' | 'dock' | 'keep'>('dock')
  const [replaceReason, setReplaceReason] = useState('')

  const active = ep.status !== 'resolved' && ep.status !== 'replacement'
  const latestBattery = ep.samples.length ? ep.samples[ep.samples.length - 1].battery : elder.battery
  const hints = buildLowBatteryHints(elder, ep.lowDays, ep.offlineAlertIds.length)
  const relatedEvents = events.filter((e) => ep.offlineAlertIds.includes(e.id))

  const renderActions = () => {
    if (!active) return null

    if (!community) {
      // 家属端操作
      return (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.TextArea
            rows={2}
            placeholder="给社区值班员留言（可选），如：老人电话没人接"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {!ep.familyRemindedAt ? (
            <Button
              type="primary"
              block
              onClick={() => {
                ackChargingReminder(ep.id, note)
                setNote('')
                message.success('已记录：您已提醒老人充电，社区将继续跟踪电量')
              }}
            >
              我已提醒老人充电
            </Button>
          ) : !ep.familyStillNotCharging ? (
            <Button
              danger
              block
              onClick={() => {
                requestVolunteer(ep.id, note)
                setNote('')
                message.success('已通知社区：老人仍未充电，将安排志愿者上门协助')
              }}
            >
              已提醒但老人仍未充电，请求志愿者上门协助
            </Button>
          ) : (
            <Alert
              type="info"
              showIcon
              message="社区已收到您的请求，将安排志愿者上门协助充电并查看老人情况"
            />
          )}
        </Space>
      )
    }

    // 社区端操作
    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        {!ep.familyRemindedAt && ep.status === 'monitoring' && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            首日低电已自动推送家属；若连续两天低电未充电，将提示家属/社区上门检查。
          </Text>
        )}
        {ep.familyRemindedAt && !ep.familyStillNotCharging && ep.status !== 'volunteer_assigned' && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            家属已于 {fmtTime(ep.familyRemindedAt)} 确认提醒老人。若老人仍未充电，可安排志愿者上门。
          </Text>
        )}
        {ep.status !== 'volunteer_assigned' && (
          <Button
            type="primary"
            block
            onClick={() => {
              assignVolunteer(ep.id)
              message.success('已安排就近志愿者上门协助充电')
            }}
          >
            {ep.familyStillNotCharging ? '安排志愿者上门协助（家属已提醒仍未充电）' : '安排志愿者上门协助充电'}
          </Button>
        )}
        {ep.chargeAssist && !ep.chargeAssist.arrivedAt && (
          <Button block onClick={() => recordVolunteerArrival(ep.id)}>
            记录志愿者到达（{ep.chargeAssist.volunteerName}）
          </Button>
        )}
        {ep.chargeAssist?.arrivedAt && !ep.chargeAssist.result && (
          <Button type="primary" block onClick={() => setAssistModal(true)}>
            记录上门协助结果
          </Button>
        )}
        {ep.chargeAssist?.result && (
          <Alert
            type={ep.chargeAssist.result === 'charged' ? 'success' : 'warning'}
            showIcon
            message={`志愿者上门结果：${RESULT_LABEL[ep.chargeAssist.result]}`}
            description={ep.chargeAssist.note}
            action={
              <Button size="small" type="primary" onClick={() => { setHelperName(ep.chargeAssist?.volunteerName ?? ''); setResolveModal(true) }}>
                完成低电处理
              </Button>
            }
          />
        )}
        <Button block onClick={() => { setHelperName(ep.chargeAssist?.volunteerName ?? ''); setResolveModal(true) }}>
          登记充电协助人并完成处理
        </Button>
        <Space.Compact block>
          <InputNumber min={1} max={100} value={batteryInput} onChange={(v) => setBatteryInput(v ?? 85)} addonAfter="%" style={{ width: '100%' }} />
          <Button
            onClick={() => {
              reportBattery(elder.id, batteryInput, 'manual')
              message.success(batteryInput > 20 ? `已上报电量 ${batteryInput}%，工单将自动闭环` : `已上报电量 ${batteryInput}%`)
            }}
          >
            模拟电量上报
          </Button>
        </Space.Compact>
        <Text type="secondary" style={{ fontSize: 11 }}>
          演示用：上报 20% 以上即视为电量恢复并自动闭环工单；也可保持低电观察跨天升级（顶栏可快进时间）。
        </Text>
      </Space>
    )
  }

  return (
    <div>
      {active && ep.lowDays >= 2 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 8 }}
          message={`手环已连续 ${ep.lowDays} 天低电未充电，存在照护风险`}
          description={
            <Space direction="vertical" size={2}>
              {hints.map((h, i) => (
                <Text key={i} style={{ fontSize: 12 }}>
                  · {h}
                </Text>
              ))}
            </Space>
          }
        />
      )}
      {active && ep.lowDays < 2 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          message={`设备低电第 ${ep.lowDays} 天，已推送家属充电提醒`}
          description={hints.map((h, i) => (
            <Text key={i} style={{ fontSize: 12 }}>
              · {h}
              <br />
            </Text>
          ))}
        />
      )}

      <Descriptions column={2} size="small">
        <Descriptions.Item label="当前电量">
          <Space>
            <Progress percent={latestBattery} size="small" status={latestBattery <= 20 ? 'exception' : 'success'} style={{ width: 110 }} />
            <Text type={latestBattery <= 20 ? 'danger' : undefined} strong>
              {latestBattery}%
            </Text>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="低电天数">
              <Tag color={ep.lowDays >= 2 ? 'red' : 'gold'}>连续 {ep.lowDays} 天</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="设备编号">{ep.deviceId}</Descriptions.Item>
        <Descriptions.Item label="首次低电">{fmtTime(ep.startedAt)}</Descriptions.Item>
        <Descriptions.Item label="佩戴习惯" span={2}>
          {elder.wearingHabit}
        </Descriptions.Item>
        <Descriptions.Item label="工单状态" span={2}>
          <Tag color={STATUS_COLOR[ep.status]}>{BATTERY_CARE_STATUS_LABEL[ep.status]}</Tag>
          {ep.familyStillNotCharging && <Tag color="volcano">家属已提醒但老人仍未充电</Tag>}
        </Descriptions.Item>
      </Descriptions>

      {relatedEvents.length > 0 && (
        <div style={{ margin: '8px 0' }}>
          <Text strong style={{ fontSize: 12 }}>
            低电期间离线告警：
          </Text>{' '}
          {relatedEvents.map((e) => (
            <Tag
              key={e.id}
              color={e.status === 'closed' ? 'default' : 'red'}
              style={{ cursor: onOpenEvent ? 'pointer' : 'default' }}
              onClick={() => onOpenEvent?.(e.id)}
            >
              {e.id}（{e.status === 'closed' ? '已结案' : '处置中'}）
            </Tag>
          ))}
          <Text type="secondary" style={{ fontSize: 11 }}>
            低电期间发生的离线告警将把“设备维护不及时”纳入事件复盘
          </Text>
        </div>
      )}

      {ep.replacement?.relatedEpisodeId && active && (
        <Alert
          style={{ margin: '8px 0' }}
          type="warning"
          showIcon
          message={`该设备再次低电（上一次工单 ${ep.replacement.relatedEpisodeId} 已闭环），是否需要更换设备或充电底座？`}
          action={
            community ? (
              <Button size="small" onClick={() => setReplaceModal(true)}>
                更换评估
              </Button>
            ) : undefined
          }
        />
      )}

      {ep.chargeAssist && (
        <Descriptions column={1} size="small" bordered style={{ margin: '8px 0' }}>
          <Descriptions.Item label="志愿者">
            {ep.chargeAssist.volunteerName}（{ep.chargeAssist.volunteerPhone}）
          </Descriptions.Item>
          <Descriptions.Item label="派单/到达">
            {fmtTime(ep.chargeAssist.assignedAt)}
            {ep.chargeAssist.arrivedAt ? ` · 到达 ${fmtTime(ep.chargeAssist.arrivedAt)}` : ' · 待到达'}
          </Descriptions.Item>
          {ep.chargeAssist.result && <Descriptions.Item label="结果">{RESULT_LABEL[ep.chargeAssist.result]}</Descriptions.Item>}
        </Descriptions>
      )}

      <div style={{ margin: '8px 0' }}>{renderActions()}</div>

      {ep.resolution && (
        <Alert
          style={{ marginBottom: 8 }}
          type="success"
          showIcon
          message={`低电已处理完成 · ${fmtTime(ep.resolution.at)} 闭环`}
          description={
            <Space direction="vertical" size={2}>
              <Text style={{ fontSize: 12 }}>充电协助人：{ep.resolution.helperName}（{ROLE_LABEL[ep.resolution.helperRole]}）</Text>
              <Text style={{ fontSize: 12 }}>
                恢复时间：{fmtTime(ep.resolution.recoveredAt)} · 恢复后电量：{ep.resolution.batteryAfter}%
              </Text>
              <Text style={{ fontSize: 12 }}>备注：{ep.resolution.note}</Text>
            </Space>
          }
        />
      )}
      {ep.status === 'replacement' && ep.replacement && (
        <Alert
          style={{ marginBottom: 8 }}
          type="info"
          showIcon
          message={`已决定${ep.replacement.option === 'device' ? '更换设备' : '更换充电底座'} · ${fmtTime(ep.replacement.at)}`}
          description={`${ep.replacement.decidedBy}：${ep.replacement.reason}`}
        />
      )}

      <Paragraph style={{ fontSize: 12, marginTop: 8 }}>
        <ThunderboltOutlined /> <Text strong>提醒/协助记录</Text>
      </Paragraph>
      <Timeline
        items={ep.reminders.map((r) => ({
          color: r.role === 'volunteer' ? 'purple' : r.role === 'family' ? 'blue' : r.role === 'community' ? 'geekblue' : 'gray',
          children: (
            <Text style={{ fontSize: 12 }}>
              {fmtTime(r.at)} <Tag>{ROLE_LABEL[r.role]}</Tag>
              {r.by}：{r.note}
            </Text>
          ),
        }))}
      />

      {/* 志愿者上门结果 */}
      <Modal
        title="记录志愿者上门协助结果"
        open={assistModal}
        onCancel={() => setAssistModal(false)}
        onOk={() => {
          recordChargeAssist(ep.id, assistResult, assistNote)
          setAssistModal(false)
          setAssistNote('')
          message.success('协助结果已记录')
        }}
      >
        <Radio.Group
          value={assistResult}
          onChange={(e) => setAssistResult(e.target.value)}
          options={(Object.keys(RESULT_LABEL) as (keyof typeof RESULT_LABEL)[]).map((k) => ({ value: k, label: RESULT_LABEL[k] }))}
        />
        <Input.TextArea rows={2} style={{ marginTop: 12 }} placeholder="现场情况（充电触点、底座供电、老人状态等）" value={assistNote} onChange={(e) => setAssistNote(e.target.value)} />
      </Modal>

      {/* 完成低电处理 */}
      <Modal
        title="完成低电处理：记录充电协助人与恢复时间"
        open={resolveModal}
        onCancel={() => setResolveModal(false)}
        onOk={() => {
          const name = helperName.trim() || ep.chargeAssist?.volunteerName || '值班员'
          resolveBatteryCare(
            ep.id,
            name,
            ep.chargeAssist ? 'volunteer' : 'community',
            resolveNote || '设备已恢复充电',
            recoveredBattery,
          )
          setResolveModal(false)
          setHelperName('')
          setResolveNote('')
          message.success('低电照护工单已闭环，协助人与恢复时间已记录')
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input addonBefore="充电协助人" value={helperName} onChange={(e) => setHelperName(e.target.value)} placeholder={ep.chargeAssist?.volunteerName ?? '协助人姓名'} />
          <InputNumber min={1} max={100} value={recoveredBattery} onChange={(v) => setRecoveredBattery(v ?? 85)} addonAfter="%" style={{ width: '100%' }} addonBefore="恢复后电量" />
          <Text type="secondary" style={{ fontSize: 12 }}>
            恢复时间取志愿者到达时间（{ep.chargeAssist?.arrivedAt ? fmtTime(ep.chargeAssist.arrivedAt) : '当前时间'}），恢复后电量以登记/上报为准。
          </Text>
          <Input.TextArea rows={2} placeholder="处置备注（可选）" value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} />
        </Space>
      </Modal>

      {/* 更换设备/底座决定 */}
      <Modal
        title="再次低电：设备 / 充电底座更换评估"
        open={replaceModal}
        onCancel={() => setReplaceModal(false)}
        onOk={() => {
          decideReplacement(ep.id, replaceOption, replaceReason)
          setReplaceModal(false)
          setReplaceReason('')
          message.success(replaceOption === 'keep' ? '已登记：暂不更换，继续加强提醒' : '更换决定已登记并生成设备维护工单')
        }}
      >
        <Radio.Group
          value={replaceOption}
          onChange={(e) => setReplaceOption(e.target.value)}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          options={[
            { value: 'device', label: '更换手环设备（电池老化/无法充电）' },
            { value: 'dock', label: '更换充电底座（触点接触不良/供电异常）' },
            { value: 'keep', label: '暂不更换，加强充电提醒与跟踪' },
          ]}
        />
        <Input.TextArea rows={2} style={{ marginTop: 12 }} placeholder="判定依据（可选）" value={replaceReason} onChange={(e) => setReplaceReason(e.target.value)} />
      </Modal>
    </div>
  )
}

export default BatteryCareCard
