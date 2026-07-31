import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeCategory } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import { useCategories } from '../contexts/CategoryContext';
import { useNotification } from '../contexts/NotificationContext';
import { downloadBackup, exportDatabase, importDatabase, listBackups } from '../db/database';


const CATEGORY_ICONS: Record<string, string> = {
  '发圈': '🎀',
  '发卡': '🪮',
  '耳环': '💎',
  '项链': '📿',
  '手链': '💫',
  '戒指': '💍',
  '眼影': '🎨',
  '口红': '💄',
  '盒子': '📦',
};

export default function Dashboard() {
  const { categories, loading, error, refresh } = useCategories();
  const { notify } = useNotification();
  const navigate = useNavigate();
  const [normalizing, setNormalizing] = useState<number | null>(null);
  const [confirmCat, setConfirmCat] = useState<{ id: number; name: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [exportUrl, setExportUrl] = useState('');
  const [showBackups, setShowBackups] = useState(false);
  const [backupList, setBackupList] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);


  const totalItems = categories.reduce((sum, c) => sum + c.item_count, 0);
  const canNormalizeAny = categories.some((c) => c.can_normalize);

  const handleNormalize = async (catId: number) => {
    setConfirmCat(null);
    setNormalizing(catId);
    try {
      await normalizeCategory(catId);
      notify('归一化完成', 'success');
      refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : '归一化失败', 'error');
    } finally {
      setNormalizing(null);
    }
  };

  const handleShowBackups = () => {
    setBackupList(listBackups());
    setShowBackups(true);
  };

  const handleDownloadBackup = async (filename: string) => {
    try {
      await downloadBackup(filename);
      setShowBackups(false);
    } catch (e) {
      notify(e instanceof Error ? e.message : '下载失败', 'error');
    }
  };

  const handleExport = () => {
    try {
      const fullUrl = exportDatabase();
      setExportUrl(fullUrl);
    } catch (e) {
      notify(e instanceof Error ? e.message : '导出失败', 'error');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await importDatabase(file);
      notify('数据库导入成功，即将刷新', 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      notify(err instanceof Error ? err.message : '导入失败', 'error');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) return <LoadingSpinner />;

  if (error) {
    return (
      <div className="status-msg error">
        <p>{error}</p>
        <button className="btn-outline" onClick={refresh} style={{ marginTop: 12 }}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2>仪表盘</h2>

      {/* 统计摘要 */}
      <div className="stat-bar">
        <div className="stat-item">
          <span className="stat-value">{totalItems}</span>
          <span className="stat-label">首饰总数</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{categories.length}</span>
          <span className="stat-label">分类</span>
        </div>
        {canNormalizeAny && (
          <div className="stat-item">
            <span className="stat-value" style={{ color: '#2e7d32' }}>✓</span>
            <span className="stat-label">可归一化</span>
          </div>
        )}
      </div>

      {/* 分类卡片 */}
      <div className="category-grid">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="category-card"
            onClick={() => navigate(`/categories/${cat.id}`)}
            style={{ cursor: 'pointer' }}
          >
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>
              {CATEGORY_ICONS[cat.name_zh] ?? '📦'}
            </div>
            <h3>{cat.name_zh}</h3>
            <p style={{ color: '#666', fontSize: '0.9rem' }}>
              {cat.item_count} 件
            </p>
            {cat.can_normalize && (
              <button
                className="btn-sm"
                style={{ marginTop: 8 }}
                disabled={normalizing === cat.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmCat({ id: cat.id, name: cat.name_zh });
                }}
              >
                {normalizing === cat.id ? '归一化中…' : '归一化'}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 数据备份 */}
      <div style={{ marginTop: 32, padding: '16px 0', borderTop: '1px solid #eee' }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: 12, color: '#666' }}>数据备份</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn-outline btn-sm" onClick={handleExport}>
            📥 导出数据库
          </button>
          <button className="btn-outline btn-sm" onClick={handleShowBackups}>
            📂 查看备份
          </button>
          <label className="btn-outline btn-sm" style={{ cursor: 'pointer' }}>
            {importing ? '导入中…' : '📤 导入数据库'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".db"
              onChange={handleImport}
              hidden
            />
          </label>
        </div>
        <p style={{ fontSize: '0.75rem', color: '#999', marginTop: 8 }}>
          每天自动备份，保留最近 30 天 · 上次：
          {localStorage.getItem('jewelry_last_backup_date') || '暂无'}
        </p>
        <p style={{ fontSize: '0.7rem', color: '#bbb', marginTop: 4 }}>
          ver 7.30.6 · {import.meta.env.MODE}
        </p>
      </div>



      {/* 备份列表弹窗 */}
      {showBackups && (
        <div className="confirm-overlay" onClick={() => setShowBackups(false)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3 style={{ marginTop: 0 }}>📂 自动备份</h3>
            {backupList.length === 0 ? (
              <p style={{ color: '#999' }}>暂无备份，明天打开 App 后自动创建</p>
            ) : (
              <div style={{ maxHeight: 300, overflow: 'auto' }}>
                {backupList.map((name) => {
                  const dateStr = name.replace('jewelry-backup-', '').replace('.db', '');
                  return (
                    <div key={name} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 0', borderBottom: '1px solid #f0f0f0',
                    }}>
                      <span>📄 {dateStr}</span>
                      <button className="btn-outline btn-sm" onClick={() => handleDownloadBackup(name)}>
                        下载
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              className="btn-outline btn-sm"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => setShowBackups(false)}
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 导出下载弹窗 */}
      {exportUrl && (
        <div className="confirm-overlay" onClick={() => setExportUrl('')}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h3 style={{ marginTop: 0 }}>📥 导出数据库</h3>
            <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: 16 }}>
              将在系统浏览器中打开下载页面
            </p>
            <button
              className="btn-sm"
              style={{ width: '100%', padding: '14px', fontSize: '1rem', marginBottom: 8 }}
              onClick={() => window.open(exportUrl, '_blank')}
            >
              打开下载页面
            </button>
            <button
              className="btn-outline btn-sm"
              style={{ width: '100%' }}
              onClick={() => setExportUrl('')}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 归一化确认弹窗 */}
      <ConfirmDialog
        open={confirmCat !== null}
        title="确认归一化"
        message={`将「${confirmCat?.name}」所有首饰的佩戴次数等比例缩减，确定吗？`}
        confirmLabel="确认归一化"
        onConfirm={() => confirmCat && handleNormalize(confirmCat.id)}
        onCancel={() => setConfirmCat(null)}
      />
    </div>
  );
}
