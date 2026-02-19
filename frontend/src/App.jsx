import './App.css'
import MainLayout from './layouts/MainLayout'
import AdminDashboard from './components/AdminDashboard'
import { Toaster } from "./components/ui/toaster";
import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />} />
        <Route path="/video/:videoId" element={<MainLayout />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
export default App
