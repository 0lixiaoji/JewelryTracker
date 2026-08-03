import { useCallback, useEffect, useState } from 'react';
import { createDailyWear, updateDailyWear, fetchCategoryItems, fetchHistory, fetchWornItemIds } from '../api/client';
import { useCategories } from '../contexts/CategoryContext';
import { useNotification } from '../contexts/NotificationContext';
import CompositeImage from '../components/CompositeImage';
import LoadingSpinner from '../components/LoadingSpinner';
import type { Item, WearRecord } from '../api/types';

/** 格式化今天日期 YYYY-MM-DD */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DailyWear() {
  const { categories } = useCategories();
  const { notify } = useNotification();

  const [selections, setSelections] = useState<Record<number, number | null>>({});
  const [itemsMap, setItemsMap] = useState<Record<number, Item[]>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [todayRecord, setTodayRecord] = useState<WearRecord | null>(null);
  const [wornItemIds, setWornItemIds] = useState<Record<number, number[]>>({});

  const today = todayStr();

  // 加载每个分类的首饰 + 检查今天是否已提交
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 并行加载分类首饰、今日历史和已佩戴标记
      const [itemsResults, history, wornIds] = await Promise.all([
        Promise.all(
          categories.map(async (cat) => {
            try {
              return { catId: cat.id, items: await fetchCategoryItems(cat.id) };
            } catch {
              return { catId: cat.id, items: [] as Item[] };
            }
          }),
        ),
        fetchHistory(1, 1).catch(() => ({ items: [], total: 0, page: 1, page_size: 1 })),
        fetchWornItemIds().catch(() => ({})),
      ]);

      const map: Record<number, Item[]> = {};
      for (const r of itemsResults) {
        map[r.catId] = r.items;
      }
      setItemsMap(map);
      setWornItemIds(wornIds);

      // 检查今天是否已有记录
      const todayRec = history.items.find((r) => r.worn_at === today) ?? null;
      setTodayRecord(todayRec);

      // 如果已有今日记录，预填选中
      if (todayRec) {
        const prefill: Record<number, number | null> = {};
        for (const item of todayRec.items) {
          prefill[item.category_id] = item.id;
        }
        setSelections(prefill);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [categories, today]);

  useEffect(() => { load(); }, [load]);

  // 切换选中 — 今天已记录时也可以修改
  const toggleItem = (categoryId: number, itemId: number) => {
    setSelections((prev) => ({
      ...prev,
      [categoryId]: prev[categoryId] === itemId ? null : itemId,
    }));
  };

  // 提交（创建或更新）
  const handleSubmit = async () => {
    const items = Object.entries(selections)
      .filter(([, itemId]) => itemId !== null)
      .map(([catId, itemId]) => ({
        category_id: Number(catId),
        item_id: itemId as number,
      }));

    if (items.length === 0) {
      notify('请至少选择 1 件首饰', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (todayRecord) {
        const rec = await updateDailyWear(todayRecord.id, { items });
        setTodayRecord(rec);
        notify('今日佩戴已更新', 'success');
      } else {
        const rec = await createDailyWear({ items });
        setTodayRecord(rec);
        notify('今日佩戴已记录', 'success');
      }
      // 刷新已佩戴标记
      fetchWornItemIds().then(setWornItemIds).catch(() => {});
    } catch (e) {
      notify(e instanceof Error ? e.message : '操作失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCount = Object.values(selections).filter((v) => v !== null && v !== undefined).length;

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="page-header">
        <h2>每日佩戴</h2>
        {todayRecord && <span className="today-badge">今日已记录</span>}
      </div>

      {todayRecord && (
        <p style={{ color: '#2e7d32', fontSize: '0.9rem', marginBottom: 16 }}>
          今日已记录，可修改后重新提交。
        </p>
      )}

      {categories.map((cat) => {
          const catItems = itemsMap[cat.id] ?? [];

          return (
            <div key={cat.id} className="wear-category">
              <h3>
                {cat.name_zh}
                <span style={{ fontSize: '0.8rem', color: '#999', marginLeft: 8 }}>
                  {selections[cat.id] ? '已选 1 件' : '未选'}
                </span>
              </h3>

              {/* 组合图：单击格子选中/取消，双击全屏放大 */}
              {catItems.length > 0 && (() => {
                const pairs = catItems
                  .filter((it) => it.image_path !== null)
                  .map((it) => ({ path: it.image_path as string, id: it.id }));
                return (
                  <CompositeImage
                    imagePaths={pairs.map((p) => p.path)}
                    itemIds={pairs.map((p) => p.id)}
                    wornItemIds={wornItemIds[cat.id]}
                    selectedItemId={selections[cat.id] ?? null}
                    onCellClick={(itemId) => toggleItem(cat.id, itemId)}
                    categoryName={cat.name_zh}
                  />
                );
              })()}

              {catItems.length === 0 ? (
                <p style={{ color: '#ccc', fontSize: '0.85rem', padding: '8px 0' }}>
                  该分类暂无首饰
                </p>
              ) : (
                selections[cat.id] != null && (
                  <button
                    className="btn-clear-selection"
                    onClick={() =>
                      setSelections((prev) => ({ ...prev, [cat.id]: null }))
                    }
                  >
                    清除选择
                  </button>
                )
              )}
            </div>
          );
        })}

      {/* 底部提交栏 — 始终显示，支持创建和修改 */}
      <div className="submit-bar">
        <span className="selected-count">
          已选 {selectedCount} / {categories.length} 类
        </span>
        <button disabled={submitting || selectedCount === 0} onClick={handleSubmit}>
          {submitting
            ? '提交中…'
            : todayRecord
              ? '更新今日佩戴'
              : '提交今日佩戴'}
        </button>
      </div>
    </div>
  );
}
