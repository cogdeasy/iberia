import { Navigate, Route, Routes } from 'react-router-dom'
import { discoverPages } from './lib/pages'
import AppShell from './components/AppShell'

export default function App() {
  const pages = discoverPages()

  return (
    <AppShell pages={pages}>
      <Routes>
        {pages.map(({ path, Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}
