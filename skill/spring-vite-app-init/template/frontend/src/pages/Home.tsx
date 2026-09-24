import { useEffect, useState } from 'react'
import { http } from '@/lib/http'

export function Home() {
  const [text, setText] = useState('检查中')

  useEffect(() => {
    http
      .get<{ status: string; version: string }>('/api/v1/health')
      .then(response => setText(`${response.data.status} ${response.data.version}`))
      .catch(() => setText('后端未连接'))
  }, [])

  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">首页</h1>
      <p className="mt-2">{text}</p>
    </main>
  )
}
