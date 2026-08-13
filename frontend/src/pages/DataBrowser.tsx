import { useCallback, useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  getTableNames,
  getTableColumns,
  getTableRowCount,
  queryTableData,
} from '../db/database';
import { getImageBlobUrl, isBase64 } from '../db/services/imageStore';
import useFullscreenImageViewer from '../hooks/useFullscreenImageViewer';
import { ACCENT_CYCLE } from '../constants/categoryColors';

const ROWS_PER_PAGE = 30;

const TABLE_ICONS: Record<string, string> = {
  categories: '📂',
  items: '📦',
  wear_records: '📅',
  wear_record_items: '📋',
  normalizations: '🔄',
};

/** 将值格式化为可显示的字符串 */
function formatCell(value: unknown): string {
  if (value === null) return '(null)';
  if (value === undefined) return '';
  if (value instanceof Uint8Array) return `[BLOB ${value.length} bytes]`;
  return String(value);
}

/** image_path 列的缩略图单元格 — 异步从 OPFS 加载图片显示，点击查看原图 */
function ImageCell({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const { openImage, viewerEl } = useFullscreenImageViewer();

  useEffect(() => {
    if (isBase64(path)) {
      setUrl(path);
      return;
    }
    const opfsPath = path.includes('?') ? path.split('?')[0] : path;
    let cancelled = false;
    getImageBlobUrl(opfsPath).then((u) => {
      if (!cancelled && u) setUrl(u);
      else if (!cancelled) setFailed(true);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [path]);

  if (failed) return <span style={{ color: '#6e6250', fontSize: '0.8rem' }}>🖼️ 加载失败</span>;
  if (!url) return <span style={{ color: '#6e6250' }}>加载中…</span>;
  return (
    <>
      <img
        src={url}
        alt={path}
        title={path}
        onClick={() => openImage(path)}
        style={{
          width: 60,
          height: 60,
          objectFit: 'contain',
          borderRadius: 4,
          display: 'block',
          background: 'transparent',
          cursor: 'zoom-in',
        }}
      />
      {viewerEl}
    </>
  );
}

export default function DataBrowser() {
  const [tables, setTables] = useState<string[]>([]);
  const [rowCounts, setRowCounts] = useState<Record<string, number>>({});
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [columns, setColumns] = useState<{ cid: number; name: string; type: string; pk: number }[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);

  // 加载表列表
  useEffect(() => {
    try {
      const names = getTableNames();
      setTables(names);
      const counts: Record<string, number> = {};
      for (const name of names) {
        counts[name] = getTableRowCount(name);
      }
      setRowCounts(counts);
    } catch (e) {
      console.error('加载表列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // 选中表时加载数据
  const loadTable = useCallback(
    (tableName: string, pageNum: number) => {
      setTableLoading(true);
      setSelectedTable(tableName);
      setPage(pageNum);
      try {
        const cols = getTableColumns(tableName);
        setColumns(cols);
        const count = getTableRowCount(tableName);
        setTotalRows(count);
        const data = queryTableData(tableName, pageNum * ROWS_PER_PAGE, ROWS_PER_PAGE);
        setRows(data);

        // items 表：预暖图片缓存，ImageCell 渲染时直接命中
        if (tableName === 'items') {
          for (const row of data) {
            const p = row['image_path'];
            if (typeof p === 'string' && p) getImageBlobUrl(p);
          }
        }
      } catch (e) {
        console.error('加载表数据失败:', e);
      } finally {
        setTableLoading(false);
      }
    },
    [],
  );

  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE));

  // 选中表的循环荧光色（与仪表盘 9 分类一致），未选中时用默认金色
  const selectedIndex = tables.indexOf(selectedTable);
  const selectedAccent = selectedIndex >= 0
    ? ACCENT_CYCLE[selectedIndex % ACCENT_CYCLE.length]
    : undefined;

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <h2>数据浏览</h2>

      <div className="dbrowser-layout">
        {/* 左侧表列表 */}
        <aside className="dbrowser-sidebar">
          <h3 style={{ fontSize: '0.85rem', color: '#8ec8b8', marginBottom: 8 }}>数据库表</h3>
          {tables.map((name, index) => (
            <button
              key={name}
              className={`dbrowser-table-btn${name === selectedTable ? ' active' : ''}`}
              style={{ '--card-accent': ACCENT_CYCLE[index % ACCENT_CYCLE.length] } as React.CSSProperties}
              onClick={() => loadTable(name, 0)}
            >
              <span>{TABLE_ICONS[name] ?? '📋'}</span>
              <span className="dbrowser-table-name">{name}</span>
              <span className="dbrowser-table-count">{rowCounts[name] ?? 0} 行</span>
            </button>
          ))}
        </aside>

        {/* 右侧数据视图 */}
        <div className="dbrowser-content">
          {!selectedTable ? null : tableLoading ? (
            <LoadingSpinner />
          ) : (
            <>
              <div className="dbrowser-header">
                <span>
                  {TABLE_ICONS[selectedTable] ?? '📋'} <strong>{selectedTable}</strong>
                </span>
                <span style={{ color: '#8ec8b8', fontSize: '0.85rem' }}>
                  {totalRows} 行 · 第 {page + 1}/{totalPages} 页
                </span>
              </div>

              {/* 数据表格 */}
              <div
                className="dbrowser-table-wrap"
                style={selectedAccent ? { '--card-accent': selectedAccent } as React.CSSProperties : undefined}
              >
                <table className="dbrowser-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      {columns.map((col) => (
                        <th key={col.cid} title={col.type}>
                          {col.name}
                          {col.pk ? ' 🔑' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={columns.length + 1} style={{ textAlign: 'center', color: '#6e6250', padding: 24 }}>
                          无数据
                        </td>
                      </tr>
                    ) : (
                      rows.map((row, i) => (
                        <tr
                          key={i}
                          style={{ '--row-accent': ACCENT_CYCLE[i % ACCENT_CYCLE.length] } as React.CSSProperties}
                        >
                          <td className="dbrowser-row-num">{page * ROWS_PER_PAGE + i + 1}</td>
                          {columns.map((col) => (
                            <td key={col.cid} className="dbrowser-cell">
                              {col.name === 'image_path' && row[col.name] && typeof row[col.name] === 'string'
                                ? <ImageCell path={row[col.name] as string} />
                                : formatCell(row[col.name])
                              }
                            </td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="btn-outline btn-sm"
                    disabled={page === 0}
                    onClick={() => loadTable(selectedTable, page - 1)}
                  >
                    上一页
                  </button>
                  <span>
                    {page + 1} / {totalPages}
                  </span>
                  <button
                    className="btn-outline btn-sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => loadTable(selectedTable, page + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
