import { HashRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import NotificationToast from './components/NotificationToast';
import { CategoryProvider } from './contexts/CategoryContext';
import { NotificationProvider } from './contexts/NotificationContext';
import CategoryDetail from './pages/CategoryDetail';
import DailyWear from './pages/DailyWear';
import Dashboard from './pages/Dashboard';
import DataBrowser from './pages/DataBrowser';
import History from './pages/History';
import ItemEditor from './pages/ItemEditor';
import './App.css';

export default function App() {
  return (
    <NotificationProvider>
      <CategoryProvider>
        {/* HashRouter 兼容 Capacitor file:// 协议，无需服务端路由支持 */}
        <HashRouter>
          <NotificationToast />
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/categories/:id" element={<CategoryDetail />} />
              <Route path="/items/new" element={<ItemEditor />} />
              <Route path="/daily-wear" element={<DailyWear />} />
              <Route path="/history" element={<History />} />
              <Route path="/data-browser" element={<DataBrowser />} />
            </Route>
          </Routes>
        </HashRouter>
      </CategoryProvider>
    </NotificationProvider>
  );
}
