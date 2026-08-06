import { useEffect, useState } from 'react';
import { fetchHistory } from '../api/client';
import EmptyState from '../components/EmptyState';
import ImageWithFallback from '../components/ImageWithFallback';
import LoadingSpinner from '../components/LoadingSpinner';
import { useCategories } from '../contexts/CategoryContext';
import { getDisplayName } from '../db/services/imageStore';
import type { WearRecord } from '../api/types';

const DAY_ACCENTS = [
  '#e89850', // 发卡
  '#e890a0', // 发圈
  '#e88060', // 眼影
  '#50c8b8', // 耳环
  '#e84858', // 口红
  '#d4a848', // 项链
  '#9888d8', // 手链
  '#6098d8', // 戒指
  '#68c068', // 盒子
];

/** 将 YYYY-MM-DD 转为友好的相对日期 */
function friendlyDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  if (diff < 7) return `${diff}天前`;
  if (diff < 30) return `${Math.floor(diff / 7)}周前`;

  // 显示完整日期
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${y}/${m}/${day} 周${weekDays[d.getDay()]}`;
}

export default function History() {
  const { categories } = useCategories();
  const [records, setRecords] = useState<WearRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const load = async (p: number) => {
    setLoading(true);
    try {
      const data = await fetchHistory(p, pageSize);
      setRecords(data.items);
      setTotal(data.total);
      setPage(data.page);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); }, []);

  const totalPages = Math.ceil(total / pageSize);

  // 获取分类名称
  const getCategoryName = (catId: number) =>
    categories.find((c) => c.id === catId)?.name_zh ?? '';

  return (
    <div>
      <h2>历史记录</h2>

      {loading ? (
        <LoadingSpinner />
      ) : records.length === 0 ? (
        <EmptyState message="还没有佩戴记录" icon="📅" />
      ) : (
        <>
          {records.map((rec, i) => (
            <div
              key={rec.id}
              className="history-day"
              style={{ '--card-accent': DAY_ACCENTS[i % DAY_ACCENTS.length] } as React.CSSProperties}
            >
              <h3>
                {friendlyDate(rec.worn_at)}
                <span style={{ fontSize: '0.8rem', color: '#8ec8b8', marginLeft: 12 }}>
                  {rec.items.length} 件
                </span>
              </h3>

              <div className="history-items">
                {rec.items.map((item) => (
                  <div key={item.id} className="history-item" style={{ position: 'relative' }}>
                    {item.image_path ? (
                      <ImageWithFallback src={item.image_path} alt="" />
                    ) : (
                      <div className="img-fallback" style={{ width: 60, height: 60 }}>🖼️</div>
                    )}
                    <span
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: 'rgba(0, 0, 0, 0.45)',
                        color: '#ff0066',
                        fontSize: '0.6rem',
                        padding: '2px 0',
                        textAlign: 'center',
                        lineHeight: 1.2,
                      }}
                    >
                      {getDisplayName(item.image_path) ?? getCategoryName(item.category_id)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn-outline btn-sm"
                disabled={page <= 1}
                onClick={() => load(page - 1)}
              >
                上一页
              </button>
              <span>
                {page} / {totalPages}（共 {total} 条）
              </span>
              <button
                className="btn-outline btn-sm"
                disabled={page >= totalPages}
                onClick={() => load(page + 1)}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
