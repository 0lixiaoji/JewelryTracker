import { useCallback, useEffect, useState } from 'react';
import { createDailyWear, fetchCategoryItems, fetchHistory } from '../api/client';
import { useCategories } from '../contexts/CategoryContext';
import { useNotification } from '../contexts/NotificationContext';
import ImageWithFallback from '../components/ImageWithFallback';
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

  const today = todayStr();

  // 加载每个分类的首饰 + 检查今天是否已提交
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 并行加载分类首饰和今日历史
      const [itemsResults, history] = await Promise.all([
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
      ]);

      const map: Record<number, Item[]> = {};
      for (const r of itemsResults) {
        map[r.catId] = r.items;
      }
      setItemsMap(map);

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

  // 切换选中
  const toggleItem = (categoryId: number, itemId: number) => {
    // 如果今日已提交，不允许修改
    if (todayRecord) return;
    setSelections((prev) => ({
      ...prev,
      [categoryId]: prev[categoryId] === itemId ? null : itemId,
    }));
  };

  // 提交
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
      const rec = await createDailyWear({ items });
      setTodayRecord(rec);
      notify('今日佩戴已记录', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : '记录失败', 'error');
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
        <p style={{ color: '#e65100', fontSize: '0.9rem', marginBottom: 16 }}>
          今日已提交佩戴记录，明天再来吧。
        </p>
      )}

      {categories.map((cat) => (
        <div key={cat.id} className="wear-category">
          <h3>
            {cat.name_zh}
            <span style={{ fontSize: '0.8rem', color: '#999', marginLeft: 8 }}>
              {selections[cat.id] ? '已选 1 件' : '未选'}
            </span>
          </h3>

          {itemsMap[cat.id]?.length === 0 ? (
            <p style={{ color: '#ccc', fontSize: '0.85rem', padding: '8px 0' }}>
              该分类暂无首饰
            </p>
          ) : (
            <div className="item-picker">
              {/* 不选 */}
              <label
                className={`picker-item none ${!selections[cat.id] ? 'selected' : ''}`}
                style={{ opacity: todayRecord ? 0.5 : 1 }}
              >
                <input
                  type="radio"
                  name={`cat-${cat.id}`}
                  checked={!selections[cat.id]}
                  onChange={() =>
                    setSelections((prev) => ({ ...prev, [cat.id]: null }))
                  }
                  disabled={!!todayRecord}
                />
                不戴
              </label>

              {/* 首饰选项 */}
              {itemsMap[cat.id]?.map((item) => (
                <label
                  key={item.id}
                  className={`picker-item ${
                    selections[cat.id] === item.id ? 'selected' : ''
                  }`}
                  style={{ opacity: todayRecord ? 0.5 : 1 }}
                  onClick={() => toggleItem(cat.id, item.id)}
                >
                  <input
                    type="radio"
                    name={`cat-${cat.id}`}
                    checked={selections[cat.id] === item.id}
                    onChange={() => toggleItem(cat.id, item.id)}
                    disabled={!!todayRecord}
                  />
                  {item.image_path ? (
                    <ImageWithFallback src={`/${item.image_path}`} alt="" />
                  ) : (
                    <div
                      className="img-fallback"
                      style={{ width: 80, height: 80 }}
                    >
                      🖼️
                    </div>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* 底部提交栏 */}
      {!todayRecord && (
        <div className="submit-bar">
          <span className="selected-count">
            已选 {selectedCount} / {categories.length} 类
          </span>
          <button disabled={submitting || selectedCount === 0} onClick={handleSubmit}>
            {submitting ? '提交中…' : '提交今日佩戴'}
          </button>
        </div>
      )}
    </div>
  );
}
