import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteItem, fetchCategoryItems, normalizeCategory, updateItem } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ImageWithFallback from '../components/ImageWithFallback';
import LoadingSpinner from '../components/LoadingSpinner';
import { useCategories } from '../contexts/CategoryContext';
import { useNotification } from '../contexts/NotificationContext';
import { getDisplayName } from '../db/services/imageStore';
import type { Item } from '../api/types';

export default function CategoryDetail() {
  const { id } = useParams<{ id: string }>();
  const categoryId = Number(id);
  const { categories, refresh: refreshCategories } = useCategories();
  const { notify } = useNotification();
  const navigate = useNavigate();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [normalizing, setNormalizing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);

  const category = categories.find((c) => c.id === categoryId);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchCategoryItems(categoryId));
    } catch (e) {
      notify(e instanceof Error ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [categoryId, notify]);

  useEffect(() => { load(); }, [load]);

  // 归一化
  const handleNormalize = async () => {
    setNormalizing(true);
    try {
      await normalizeCategory(categoryId);
      notify('归一化完成', 'success');
      await load();
      refreshCategories();
    } catch (e) {
      notify(e instanceof Error ? e.message : '归一化失败', 'error');
    } finally {
      setNormalizing(false);
    }
  };

  // 删除首饰
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteItem(target.id);
      notify('首饰已删除', 'success');
      setItems((prev) => prev.filter((it) => it.id !== target.id));
      refreshCategories();
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', 'error');
    }
  };

  // 移动分类
  const handleMove = async (itemId: number, newCategoryId: number) => {
    if (newCategoryId === categoryId) return;
    try {
      await updateItem(itemId, newCategoryId);
      notify('已移动', 'success');
      setItems((prev) => prev.filter((it) => it.id !== itemId));
      refreshCategories();
    } catch (e) {
      notify(e instanceof Error ? e.message : '移动失败', 'error');
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {/* 页面头部 */}
      <div className="page-header">
        <button className="btn-back" onClick={() => navigate('/')}>
          ← 返回
        </button>
        <h2>{category?.name_zh ?? `分类 ${categoryId}`}</h2>
        {category?.can_normalize && (
          <button className="btn-sm" disabled={normalizing} onClick={handleNormalize}>
            {normalizing ? '归一化中…' : '归一化'}
          </button>
        )}
        {items.length > 0 && (
          <button className="btn-sm" onClick={() => navigate(`/items/new?categoryId=${categoryId}`)}>
            + 录入首饰
          </button>
        )}
      </div>

      {/* 首饰网格 */}
      {items.length === 0 ? (
        <EmptyState
          message="还没有首饰，快去录入吧"
          action={{ label: '录入首饰', onClick: () => navigate(`/items/new?categoryId=${categoryId}`) }}
        />
      ) : (
        <div className="item-grid">
          {items.map((item) => (
            <div key={item.id} className="item-card">
              {/* 悬浮操作按钮 */}
              <div className="item-actions">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v) handleMove(item.id, v);
                  }}
                  title="移动到其他分类"
                >
                  <option value="" disabled>移动…</option>
                  {categories
                    .filter((c) => c.id !== categoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name_zh}</option>
                    ))}
                </select>
                <button
                  className="btn-danger"
                  onClick={() => setDeleteTarget(item)}
                  title="删除"
                >
                  ✕
                </button>
              </div>

              {/* 图片 */}
              {item.image_path ? (
                <ImageWithFallback src={item.image_path} alt="" />
              ) : (
                <div className="img-fallback" style={{ aspectRatio: '1' }}>🖼️</div>
              )}

              {/* 底部信息 */}
              <div className="item-meta">
                {getDisplayName(item.image_path) && (
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#333' }}>
                    {getDisplayName(item.image_path)}
                  </span>
                )}
                <span style={{ fontSize: '0.75rem', color: '#999' }}>
                  佩戴 {item.usage_count} 次
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 确认删除弹窗 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="确认删除"
        message="删除后将无法恢复，确定要删除这件首饰吗？"
        confirmLabel="删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
