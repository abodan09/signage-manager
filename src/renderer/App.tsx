import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import ContentPage from './pages/ContentPage'
import DevicesPage from './pages/DevicesPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/content"   element={<ContentPage />} />
          <Route path="/devices"   element={<DevicesPage />} />
          <Route path="/settings"  element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
