import { NavLink, Outlet } from 'react-router-dom';
import { useSwipeBack } from '../hooks/useSwipeBack';

const NAV_ITEMS = [
  { to: '/', label: '仪表盘', end: true },
  { to: '/daily-wear', label: '每日佩戴' },
  { to: '/items/new', label: '录入首饰' },
  { to: '/history', label: '历史记录' },
];

export default function Layout() {
  const { swipeProgress } = useSwipeBack();

  return (
    <div className="app-shell">
      {/* 左滑返回指示器 */}
      {swipeProgress > 0 && (
        <div
          className="swipe-indicator"
          style={{ opacity: swipeProgress, transform: `translateX(${(swipeProgress - 1) * 40}px)` }}
        >
          ←
        </div>
      )}

      <header className="app-header">
        <h1>JewelryTracker</h1>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
