import React from 'react'
import { Button, Card, Form, Input, Layout, Space, Tag, Typography, message } from 'antd'
import { SafetyOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons'
import { useStore } from '../store/useStore'

const { Title, Text, Paragraph } = Typography

/** 测试账号：community/123456（社区值班端）、family/123456（家属端，绑定王秀兰）、family2/123456（家属端，绑定李建国-低电照护） */
const ACCOUNTS = [
  { username: 'community', password: '123456', role: 'community' as const, name: '值班员小吴', desc: '社区值班端：告警工作台、低电照护、上门处置、结案复盘、老人档案与照护画像' },
  { username: 'family', password: '123456', role: 'family' as const, name: '王莉（王秀兰女儿）', elderId: 'e1', desc: '家属端：接收告警推送，确认误报/请求电话核实/要求上门/拨打120' },
  { username: 'family2', password: '123456', role: 'family' as const, name: '刘芳（李建国儿媳）', elderId: 'e2', desc: '家属端（低电照护）：老人手环连续低电，确认已提醒/请求志愿者上门协助充电' },
]

const LoginPage: React.FC = () => {
  const login = useStore((s) => s.login)
  const [form] = Form.useForm()

  const doLogin = (v: { username: string; password: string }) => {
    const acc = ACCOUNTS.find((a) => a.username === v.username && a.password === v.password)
    if (!acc) {
      message.error('账号或密码错误')
      return
    }
    login(acc.role, acc.name, acc.elderId)
    message.success(`已登录：${acc.name}`)
  }

  return (
    <Layout style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#e6f4ff 0%,#f6ffed 100%)' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '64px 24px', width: '100%' }}>
        <Title level={2} style={{ textAlign: 'center' }}>
          <SafetyOutlined /> 社区长者智能手环告警处置平台
        </Title>
        <Paragraph type="secondary" style={{ textAlign: 'center' }}>
          告警确认 · 上门处置 · 就医联动 · 回访结案 · 照护画像
        </Paragraph>
        <Card style={{ maxWidth: 420, margin: '24px auto' }}>
          <Form form={form} layout="vertical" onFinish={doLogin} initialValues={{ username: 'community', password: '123456' }}>
            <Form.Item name="username" label="账号" rules={[{ required: true }]}>
              <Input prefix={<UserOutlined />} placeholder="community / family" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true }]}>
              <Input.Password placeholder="123456" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>
              登录
            </Button>
          </Form>
        </Card>
        <Space direction="vertical" style={{ width: '100%', maxWidth: 420, margin: '0 auto' }} size={8}>
          <Text strong>
            <TeamOutlined /> 测试账号（点击自动填充）
          </Text>
          {ACCOUNTS.map((a) => (
            <Card
              key={a.username}
              size="small"
              hoverable
              onClick={() => form.setFieldsValue({ username: a.username, password: a.password })}
            >
              <Space>
                <Tag color={a.role === 'community' ? 'geekblue' : 'green'}>{a.username} / 123456</Tag>
                <Text>{a.name}</Text>
              </Space>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {a.desc}
                </Text>
              </div>
            </Card>
          ))}
        </Space>
      </div>
    </Layout>
  )
}

export default LoginPage
