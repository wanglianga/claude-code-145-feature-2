import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Col, Form, Input, Modal, Row, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd'
import { AlertOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useStore } from '../store/useStore'
import { DUTY_STAFF } from '../store/seed'
import { AlertType, ALERT_TYPE_LABEL, ESCALATION_LABEL, EventStatus, EVENT_STATUS_LABEL } from '../types'
import { AlertTypeTag, SeverityTag, StatusTag, fmtTime } from '../components/common'
import { FAMILY_TIMEOUT_MS } from '../store/workflow'

const { Text } = Typography

const LOCATIONS = ['家-客厅', '家-卧室', '家-浴室', '家-厨房', '小区花园', '社区活动室', '社区外步道']

const DashboardPage: React.FC = () => {
  const nav = useNavigate()
  const events = useStore((s) => s.events)
  const elders = useStore((s) => s.elders)
  const raiseAlert = useStore((s) => s.raiseAlert)
  const now = useStore((s) => s.now)
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all'>('all')
  const [typeFilter, setTypeFilter] = useState<AlertType | 'all'>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()

  const active = events.filter((e) => e.status !== 'closed')
  const escalated = active.filter((e) => e.escalations.length > 0)
  const closedToday = events.filter((e) => e.status === 'closed' && e.closure && now() - e.closure.closedAt < 24 * 3600 * 1000)
  const batteryEpisodes = useStore((s) => s.batteryEpisodes)
  const lowBatteryNeedVisit = batteryEpisodes.filter(
    (ep) => ep.status !== 'resolved' && ep.status !== 'replacement' && ep.lowDays >= 2,
  )

  const rows = useMemo(
    () =>
      events.filter(
        (e) => (statusFilter === 'all' || e.status === statusFilter) && (typeFilter === 'all' || e.type === typeFilter),
      ),
    [events, statusFilter, typeFilter],
  )

  const elderName = (id: string) => elders.find((e) => e.id === id)?.name ?? id

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          <Space wrap>
            <span>今日值班：{DUTY_STAFF.map((d) => `${d.role} ${d.name}（${d.phone}）`).join(' · ')}</span>
            <Text type="secondary">家属响应时限 {Math.round(FAMILY_TIMEOUT_MS / 60000)} 分钟，超时自动升级社区接管</Text>
          </Space>
        }
      />
      {lowBatteryNeedVisit.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            <Space wrap>
              <span>
                {lowBatteryNeedVisit
                  .map((ep) => `${elders.find((e) => e.id === ep.elderId)?.name ?? ep.elderId}（连续${ep.lowDays}天低电${ep.offlineAlertIds.length ? '、已发生离线' : ''}）`)
                  .join('、')}{' '}
                的手环连续两天低电未充电，已依据佩戴习惯与历史告警提示家属/社区上门检查
              </span>
              <Button size="small" type="primary" danger ghost onClick={() => nav('/battery')}>
                进入低电照护处置
              </Button>
            </Space>
          }
        />
      )}
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="待处理告警" value={active.length} prefix={<AlertOutlined />} valueStyle={{ color: active.length ? '#cf1322' : undefined }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="已触发升级情形" value={escalated.length} prefix={<ThunderboltOutlined />} valueStyle={{ color: escalated.length ? '#fa8c16' : undefined }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="24小时内已结案" value={closedToday.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="在册独居老人" value={elders.length} suffix="位" />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        title="告警事件"
        extra={
          <Space>
            <Select
              size="small"
              value={statusFilter}
              style={{ width: 130 }}
              onChange={setStatusFilter}
              options={[{ value: 'all', label: '全部状态' }, ...Object.entries(EVENT_STATUS_LABEL).map(([v, l]) => ({ value: v, label: l }))]}
            />
            <Select
              size="small"
              value={typeFilter}
              style={{ width: 130 }}
              onChange={setTypeFilter}
              options={[{ value: 'all', label: '全部类型' }, ...Object.entries(ALERT_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))]}
            />
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
              模拟手环上报
            </Button>
          </Space>
        }
      >
        <Table
          size="small"
          rowKey="id"
          dataSource={rows}
          pagination={{ pageSize: 8 }}
          onRow={(r) => ({ onClick: () => nav(`/events/${r.id}`), style: { cursor: 'pointer' } })}
          columns={[
            { title: '事件', dataIndex: 'id', width: 90 },
            { title: '老人', render: (_, r) => elderName(r.elderId), width: 80 },
            { title: '类型', render: (_, r) => <AlertTypeTag v={r.type} />, width: 100 },
            { title: '等级', render: (_, r) => <SeverityTag v={r.severity} />, width: 70 },
            { title: '位置', dataIndex: 'location', width: 100 },
            { title: '发生时间', render: (_, r) => fmtTime(r.occurredAt), width: 100 },
            { title: '状态', render: (_, r) => <StatusTag v={r.status} />, width: 100 },
            {
              title: '升级情形',
              render: (_, r) => (
                <Space size={2} wrap>
                  {r.escalations.length === 0 && <Text type="secondary">—</Text>}
                  {r.escalations.map((e, i) => (
                    <Tag key={i} color="orange">
                      {ESCALATION_LABEL[e.kind]}
                    </Tag>
                  ))}
                </Space>
              ),
            },
            { title: '结案分类', render: (_, r) => (r.closure ? <Tag>{r.closure.category === 'device_false' ? '设备误报' : r.closure.category === 'care_gap' ? '照护缺口' : '真实风险'}</Tag> : '—'), width: 90 },
          ]}
        />
      </Card>

      <Modal
        title="模拟手环上报告警"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => {
          form.validateFields().then((v) => {
            raiseAlert(v.elderId, v.type, v.location)
            setModalOpen(false)
            form.resetFields()
            message.success('已生成告警事件并通知家属')
          })
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ elderId: elders[0]?.id, type: 'fall', location: '家-浴室' }}>
          <Form.Item name="elderId" label="老人" rules={[{ required: true }]}>
            <Select options={elders.map((e) => ({ value: e.id, label: `${e.name}（${e.address}）` }))} />
          </Form.Item>
          <Form.Item name="type" label="告警类型" rules={[{ required: true }]}>
            <Select options={Object.entries(ALERT_TYPE_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
          <Form.Item name="location" label="告警位置" rules={[{ required: true }]}>
            <Select options={LOCATIONS.map((l) => ({ value: l, label: l }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default DashboardPage
