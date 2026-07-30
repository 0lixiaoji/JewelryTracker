import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { autoBackup, initDatabase, setupAutoSave } from './db/database';

// ── 启动时初始化数据库 + 自动保存 ──────────────────────────────

initDatabase()
  .then(() => {
    setupAutoSave();
    autoBackup(); // 每天自动备份
  })
  .catch((err) => {
    console.error('数据库初始化失败:', err);
  });

// ── 渲染 ────────────────────────────────────────────────────────

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ── PWA 更新提示 ─────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
      // 新版本可用，刷新页面
      if (confirm('发现新版本，是否刷新？')) {
        window.location.reload();
      }
    }
  });
}
