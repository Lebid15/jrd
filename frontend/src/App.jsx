import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Archive from './pages/Archive.jsx';
import MonthlyArchive from './pages/MonthlyArchive.jsx';
import Photos from './pages/Photos.jsx';
import Currency from './pages/Currency.jsx';
import ApiSettings from './pages/ApiSettings.jsx';
import Bank from './pages/Bank.jsx';
import WhatsApp from './pages/WhatsApp.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="flex-1 p-4 md:p-6 md:mr-64 mt-14 md:mt-0 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/archive" element={<Archive />} />
            <Route path="/monthly" element={<MonthlyArchive />} />
            <Route path="/photos" element={<Photos />} />
            <Route path="/currency" element={<Currency />} />
            <Route path="/api-settings" element={<ApiSettings />} />
            <Route path="/bank" element={<Bank />} />
            <Route path="/whatsapp" element={<WhatsApp />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
