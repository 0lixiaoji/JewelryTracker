import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { deleteItem, fetchCategoryItems, normalizeCategory, replaceItemImage, updateItem } from '../api/client';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ImageWithFallback from '../components/ImageWithFallback';
import LoadingSpinner from '../components/LoadingSpinner';
import { useCategories } from '../contexts/CategoryContext';
import { useNotification } from '../contexts/NotificationContext';
import { getDisplayName, isBase64, parsePrefixFromFilename } from '../db/services/imageStore';
import useFullscreenImageViewer from '../hooks/useFullscreenImageViewer';
import { ACCENT_CYCLE, COOL_CYCLE, WARM_CYCLE } from '../constants/categoryColors';
import type { Item } from '../api/types';

// 双类型分类（手链/耳环）的卡片取色：
// 数量多的类型 → 暖色系循环，数量少的类型 → 冷色系循环，两种类型一眼可分。
// base64 / 无图（无法解析前缀）统一归入哨兵组，不影响双类型判断。
const UNPARSEABLE_PREFIX = '￿';

function itemPrefix(imagePath: string | null): string {
  if (!imagePath || isBase64(imagePath)) return UNPARSEABLE_PREFIX;
  return parsePrefixFromFilename(imagePath);
}

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
  const { openGallery, viewerEl } = useFullscreenImageViewer();

  // 可点击查看原图的图片路径列表（无图的首饰不参与，用于左右滑动切换）
  const galleryPaths = useMemo(
    () => items.filter((it) => it.image_path).map((it) => it.image_path as string),
    [items],
  );

  // 点击图片 → 打开整个网格的可滑动原图浏览（从被点击的这张开始）
  const handleOpenImage = useCallback(
    (item: Item) => {
      const idx = galleryPaths.indexOf(item.image_path as string);
      openGallery(galleryPaths, idx >= 0 ? idx : 0);
    },
    [galleryPaths, openGallery],
  );

  const category = categories.find((c) => c.id === categoryId);

  // 双类型分类（手链/耳环）的取色与列位：
  // - 数量多的类型走暖色系、与少类型并排的前段占左两列（列位 1,2,1,2…）
  // - 数量少的类型走冷色系、固定右列（列位 3），避免数量多的为奇数时被顶到第 2 列
  // - 少类型排完后，续排前 3 行右列各空一格，多类型剩余部分再铺满三列（列位 1,2 ×3 行，之后 1,2,3…）
  // 单类型保持原 9 色循环、自动填充。
  const dualTypeLayout = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      const p = itemPrefix(it.image_path);
      const arr = groups.get(p) ?? [];
      arr.push(it);
      groups.set(p, arr);
    }

    const accents = new Map<number, string>();
    const columns = new Map<number, number>();
    const groupList = [...groups.values()];
    const isDual = groupList.length === 2;
    if (isDual) {
      const [major, minor] = groupList.sort((a, b) => b.length - a.length);
      // 前 pairedCount 个「多类型」与「少类型」并排（多占左两列、少固定右列）；
      // 少类型排完后，续排前 3 行右列各空一格，其余多类型再铺满三列。
      const pairedCount = Math.min(major.length, minor.length * 2);
      major.forEach((it, i) => {
        accents.set(it.id, WARM_CYCLE[i % WARM_CYCLE.length]);
        if (i < pairedCount) {
          columns.set(it.id, (i % 2) + 1); // 与少类型并排：左两列左右交替
        } else {
          // 少类型结束后：续排前 3 行右列（列位 3）各空一格，之后再铺满三列。
          // 并排段占 minor.length 行（少类型每件占一行右列），续排从下一行开始；
          // 前 3 行每行只占列 1、2（每 2 个续排项空 1 格），至多空 3 格。
          const j = i - pairedCount;
          const gapCells = Math.min(Math.floor(j / 2), 3);
          const cellIndex = minor.length * 3 + j + gapCells;
          columns.set(it.id, (cellIndex % 3) + 1);
        }
      });
      minor.forEach((it, i) => {
        accents.set(it.id, COOL_CYCLE[i % COOL_CYCLE.length]);
        columns.set(it.id, 3); // 少的始终在右列
      });
    } else {
      items.forEach((it, i) => accents.set(it.id, ACCENT_CYCLE[i % ACCENT_CYCLE.length]));
    }
    return { accents, columns, isDual };
  }, [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchCategoryItems(categoryId, 'nameDesc'));
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
        <button className="btn-back" onClick={() => navigate(-1)}>
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
        <div
          className="item-grid"
          style={dualTypeLayout.isDual ? { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' } : undefined}
        >
          {items.map((item, index) => (
            <div
              key={item.id}
              className="item-card"
              style={{
                '--card-accent': dualTypeLayout.accents.get(item.id) ?? ACCENT_CYCLE[index % ACCENT_CYCLE.length],
                gridColumn: dualTypeLayout.columns.get(item.id) ?? undefined,
              } as React.CSSProperties}
            >
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
                  className="btn-sm"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;
                      try {
                        const updated = await replaceItemImage(item.id, file);
                        setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
                        notify('图片已更新', 'success');
                      } catch (err) {
                        notify(err instanceof Error ? err.message : '换图失败', 'error');
                      }
                    };
                    input.click();
                  }}
                  title="更换图片"
                >
                  🖼️
                </button>
                <button
                  className="btn-danger"
                  onClick={() => setDeleteTarget(item)}
                  title="删除"
                >
                  ✕
                </button>
              </div>

              {/* 图片 — 点击查看原图 */}
              {item.image_path ? (
                <div
                  onClick={() => handleOpenImage(item)}
                  style={{ cursor: 'zoom-in' }}
                >
                  <ImageWithFallback src={item.image_path} alt="" />
                </div>
              ) : (
                <div className="img-fallback" style={{ aspectRatio: '1' }}>🖼️</div>
              )}

              {/* 底部信息 */}
              <div className="item-meta">
                {getDisplayName(item.image_path) && (
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#ff0066' }}>
                    {getDisplayName(item.image_path)}
                  </span>
                )}
                <span style={{ fontSize: '0.75rem', color: '#8ec8b8' }}>
                  佩戴 {item.usage_count} 次</span>
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

      {/* 全屏查看原图 */}
      {viewerEl}
    </div>
  );
}
