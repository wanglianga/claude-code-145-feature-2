import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Col, Empty, InputNumber, Row, Select, Space, Table, Tag, Typography, message } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { useStore } from '../store/useStore'
import { BatteryCareEpisode, BATTERY_CARE_STATUS_LABEL } from '../types'
import BatteryCareCard from '../components/BatteryCareCard'
import { fmtTime } from '../components/common'

const { Text } = Typography

const STATUS_COLOR: Record<BatteryCareEpisode['status'], string> = {
  monitoring: 'gold',
  visit_suggested: 'red',
  family_reminded: 'blue',
  volunteer_assigned: 'purple',
  resolved: 'green',
  replacement: 'orange',
}

/** 设备低电照护：连续两天低电未充电的风险跟踪、家属提醒、志愿者协助、更换评估 */
const BatteryCarePage: React.FC = () => {
  const nav = useNavigate()
  const elders = useStore((s) => s.elders)
  const episodes = useStore((s) => s.batteryEpisodes)
  const reportBattery = useStore((s) => s.reportBattery)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [simElder, setSimElder] = useState<string>(elders[1]?.id ?? elders[0]?.id)
  const [simBattery, setSimBattery] = useState<number>(15)

  const elderName = (id: string) => elders.find((e) => e.id === id)?.name ?? id
  const active = useMemo(
    () => episodes.filter((ep) => ep.status !== 'resolved' && ep.status !== 'replacement'),
    [episodes],
  )
  const needVisit = active.filter((ep) => ep.lowDays >= 2)
  const history = useMemo(
    () =>
      episodes
        .filter((ep) => ep.status === 'resolved' || ep.status === 'replacement')
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [episodes],
  )

  const selected = episodes.find((ep) => ep.id === selectedId) ?? active[0]
  const selectedElder = elders.find((e) => e.id === selected?.elderId)

  return (
    <div>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          <Space wrap>
            <ThunderboltOutlined />
            <span>
              当前有 <Text strong type="danger">{needVisit.length}</Text> 位老人手环连续两天低电未充电，已根据佩戴习惯与历史告警提示家属/社区上门检查；
              家属确认已提醒但老人仍未充电时，可安排志愿者协助充电。
            </span>
          </Space>
        }
      />

      <Row gutter={12}>
        <Col xs={24} lg={13}>
          <Card
            size="small"
            title={`低电照护工单（进行中 ${active.length}）`}
            extra={
              <Space>
                <Select
                  size="small"
                  value={simElder}
                  style={{ width: 150 }}
                  onChange={setSimElder}
                  options={elders.map((e) => ({ value: e.id, label: `${e.name}（${e.battery}%）` }))}
                />
                <InputNumber size="small" min={1} max={100} value={simBattery} onChange={(v) => setSimBattery(v ?? 15)} addonAfter="%" />
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<ThunderboltOutlined />}
                  onClick={() => {
                    reportBattery(simElder, simBattery, 'manual')
                    message.success(`已模拟 ${elderName(simElder)} 手环电量上报：${simBattery}%`)
                  }}
                >
                  模拟电量上报
                </Button>
              </Space>
            }
          >
            <Table
              size="small"
              rowKey="id"
              dataSource={active}
              pagination={false}
              onRow={(r) => ({ onClick: () => setSelectedId(r.id), style: { cursor: 'pointer' } })}
              rowClassName={(r) => (r.id === selected?.id ? 'ant-table-row-selected' : '')}
              columns={[
                { title: '工单', dataIndex: 'id', width: 90 },
                { title: '老人', render: (_, r) => elderName(r.elderId), width: 80 },
                {
                  title: '最新电量',
                  render: (_, r) => {
                    const b = r.samples.length ? r.samples[r.samples.length - 1].battery : 0
                    return <Tag color={b <= 20 ? 'red' : 'green'}>{b}%</Tag>
                  },
                  width: 80,
                },
                {
                  title: '低电天数',
                  render: (_, r) => <Tag color={r.lowDays >= 2 ? 'red' : 'gold'}>第{r.lowDays}天</Tag>,
                  width: 80,
                },
                { title: '状态', render: (_, r) => <Tag color={STATUS_COLOR[r.status]}>{BATTERY_CARE_STATUS_LABEL[r.status]}</Tag>, width: 110 },
                {
                  title: '提示',
                  render: (_, r) => (
                    <Space size={2} wrap>
                      {r.familyStillNotCharging && <Tag color="volcano">提醒后仍未充电</Tag>}
                      {r.offlineAlertIds.length > 0 && <Tag color="red">低电期离线×{r.offlineAlertIds.length}</Tag>}
                      {r.replacement?.relatedEpisodeId && <Tag color="orange">再次低电</Tag>}
                      {!r.familyStillNotCharging && r.offlineAlertIds.length === 0 && !r.replacement?.relatedEpisodeId && (
                        <Text type="secondary">—</Text>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
            {active.length === 0 && <Empty description="当前没有进行中的低电照护工单" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>

          <Card size="small" title="历史低电处理记录" style={{ marginTop: 12 }}>
            <Table
              size="small"
              rowKey="id"
              dataSource={history}
              pagination={{ pageSize: 5 }}
              columns={[
                { title: '工单', dataIndex: 'id', width: 90 },
                { title: '老人', render: (_, r) => elderName(r.elderId), width: 80 },
                {
                  title: '充电协助人',
                  render: (_, r) => r.resolution?.helperName ?? '—',
                },
                { title: '恢复时间', render: (_, r) => (r.resolution ? fmtTime(r.resolution.recoveredAt) : '—'), width: 110 },
                {
                  title: '结论',
                  width: 120,
                  render: (_, r) =>
                    r.status === 'replacement' ? (
                      <Tag color="orange">{r.replacement?.option === 'device' ? '已更换设备' : '已更换底座'}</Tag>
                    ) : (
                      <Tag color="green">已恢复充电{r.resolution ? `（${r.resolution.batteryAfter}%）` : ''}</Tag>
                    ),
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={11}>
          {selected && selectedElder ? (
            <Card
              size="small"
              title={
                <Space wrap>
                  <ThunderboltOutlined />
                  工单 {selected.id} · {selectedElder.name}
                  <Tag color={STATUS_COLOR[selected.status]}>{BATTERY_CARE_STATUS_LABEL[selected.status]}</Tag>
                </Space>
              }
            >
              <BatteryCareCard
                episode={selected}
                elder={selectedElder}
                community
                onOpenEvent={(eventId) => nav(`/events/${eventId}`)}
              />
            </Card>
          ) : (
            <Card size="small">
              <Empty description="暂无低电照护工单" />
            </Card>
          )}
        </Col>
      </Row>
    </div>
  )
}

export default BatteryCarePage
