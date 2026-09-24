import { HashRouter, Route, Routes } from 'react-router-dom'
import { Home } from '@/pages/Home'

export function App() {
  const raw = import.meta.env.BASE_URL || '/'
  const basename = raw === './' || raw === '.' ? '/' : raw.replace(/\/$/, '') || '/'
  return (
    <HashRouter basename={basename}>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </HashRouter>
  )
}
