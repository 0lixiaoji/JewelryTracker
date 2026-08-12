import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeCategory } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import { useCategories } from '../contexts/CategoryContext';
import { useNotification } from '../contexts/NotificationContext';
import { CATEGORY_ACCENTS, DEFAULT_ACCENT } from '../constants/categoryColors';
import {
  downloadBackup,
  exportDatabaseWithImages,
  importDatabase,
  listBackups,
} from '../db/database';


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

  // ── 导出 ─────────────────────────────────────────────────────────
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');

  // ── 导入 ─────────────────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 备份管理 ─────────────────────────────────────────────────────
  const [showBackups, setShowBackups] = useState(false);
  const [backupList, setBackupList] = useState<string[]>([]);

  const totalItems = categories.reduce((sum, c) => sum + c.item_count, 0);
  const canNormalizeAny = categories.some((c) => c.can_normalize);

  // ── 归一化 ───────────────────────────────────────────────────────
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

  // ── 导出 ─────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    setExportProgress('准备中…');
    try {
      const result = await exportDatabaseWithImages((current, total) => {
        setExportProgress(`${current}/${total}`);
      });
      setExportProgress('');
      if (result === 'shared') {
        notify('请在分享面板中选择「保存到文件」', 'success');
      } else {
        notify('浏览器下载已开始', 'success');
      }
    } catch (e) {
      setExportProgress('');
      notify(e instanceof Error ? e.message : '导出失败', 'error');
    } finally {
      setExporting(false);
    }
  };

  // ── 导入 ─────────────────────────────────────────────────────────
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await importDatabase(file);
      notify('导入成功，即将刷新', 'success');
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      notify(err instanceof Error ? err.message : '导入失败', 'error');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── 备份管理 ─────────────────────────────────────────────────────
  const handleShowBackups = () => {
    setBackupList(listBackups());
    setShowBackups(true);
  };

  const handleDownloadBackup = async (filename: string) => {
    try {
      const result = await downloadBackup(filename);
      if (result === 'shared') {
        notify('请在分享面板中选择保存位置', 'success');
      } else {
        notify('浏览器下载已开始', 'success');
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : '下载失败', 'error');
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
            <span className="stat-value" style={{ color: '#7db87d' }}>✓</span>
            <span className="stat-label">可归一化</span>
          </div>
        )}
      </div>

      {/* 分类卡片 */}
      <div className="category-grid">
        {categories.map((cat) => {
          const accent = CATEGORY_ACCENTS[cat.name_zh] ?? DEFAULT_ACCENT;
          return (
          <div
            key={cat.id}
            className="category-card"
            style={{ '--card-accent': accent } as React.CSSProperties}
            onClick={() => navigate(`/categories/${cat.id}`)}
          >
            <div className="category-card-icon">
              {CATEGORY_ICONS[cat.name_zh] ?? '📦'}
            </div>
            <h3 className="category-card-name">{cat.name_zh}</h3>
            <div className="category-card-count">
              <span className="count-num">{cat.item_count}</span>
              <span className="count-unit">件</span>
            </div>
            {cat.can_normalize && (
              <button
                className="category-card-action"
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
          );
        })}
      </div>

      {/* 数据备份 */}
      <div style={{ marginTop: 32, padding: '16px 0', borderTop: '1px solid #3e3424' }}>
        <h3 style={{ fontSize: '0.95rem', marginBottom: 12, color: '#f0c060' }}>数据备份</h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn-sm" style={{ paddingLeft: 6, paddingRight: 6 }} onClick={handleExport} disabled={exporting}>
            {exporting
              ? (exportProgress ? `⏳ ${exportProgress}` : '⏳ 打包中…')
              : '📥 导出备份'}
          </button>
          <button className="btn-sm" style={{ paddingLeft: 6, paddingRight: 6 }} onClick={handleShowBackups}>
            📂 查看备份
          </button>
          <label className="btn-outline btn-sm" style={{ cursor: 'pointer' }}>
            {importing ? '⏳ 导入中…' : '📤 导入备份'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".db,.zip"
              onChange={handleImport}
              hidden
            />
          </label>
        </div>
        <p style={{ fontSize: '0.75rem', color: '#8ec8b8', marginTop: 8 }}>
          每日自动备份，保留近 5 天 · 上次：
          {localStorage.getItem('jewelry_last_backup_date') || '暂无'}
        </p>
        <p style={{ fontSize: '0.7rem', color: '#6e6250', marginTop: 4 }}>
          ver 7.30.6 · {import.meta.env.MODE}
        </p>
      </div>

      {/* ── 备份管理弹窗 ──────────────────────────────────────────── */}
      {showBackups && (
        <div className="modal-overlay" onClick={() => setShowBackups(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h4 style={{ fontSize: '0.85rem', color: '#8ec8b8', marginBottom: 8 }}>
              自动备份 ({backupList.length})
            </h4>

            {backupList.length === 0 ? (
              <p style={{ color: '#6e6250', fontSize: '0.85rem' }}>
                暂无备份，明天打开 App 后自动创建
              </p>
            ) : (
              <div style={{ maxHeight: 260, overflow: 'auto' }}>
                {backupList.map((name) => {
                  const dateStr = name.replace('jewelry-backup-', '').replace('.zip', '').replace('.db', '');
                  return (
                    <div
                      key={name}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 0', borderBottom: '1px solid #2e3048',
                      }}
                    >
                      <span>📄 {dateStr}</span>
                      <button
                        className="btn-outline btn-sm"
                        onClick={() => handleDownloadBackup(name)}
                      >
                        下载
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-outline btn-sm" onClick={() => setShowBackups(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 归一化确认弹窗 ────────────────────────────────────────── */}
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
