import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeCategory } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import { useCategories } from '../contexts/CategoryContext';
import { useNotification } from '../contexts/NotificationContext';

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
