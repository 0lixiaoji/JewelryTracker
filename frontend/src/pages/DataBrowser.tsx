import { useCallback, useEffect, useState } from 'react';
import LoadingSpinner from '../components/LoadingSpinner';
import {
  getTableNames,
  getTableColumns,
  getTableRowCount,
  queryTableData,
  getImageBlobUrl,
} from '../db/database';

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

  // 图片 blob URL 缓存（items 表用）
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

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

        // items 表：异步加载图片缩略图
        if (tableName === 'items') {
          loadItemThumbnails(data);
        } else {
          setImageUrls({});
        }
      } catch (e) {
        console.error('加载表数据失败:', e);
      } finally {
        setTableLoading(false);
      }
    },
    [],
  );

  // 加载 items 表的缩略图
  const loadItemThumbnails = useCallback(async (items: Record<string, unknown>[]) => {
    const urls: Record<string, string> = {};
    for (const item of items) {
      const imagePath = item['image_path'];
      if (typeof imagePath === 'string' && imagePath) {
        // base64 图片直接使用
        if (imagePath.startsWith('data:')) {
          urls[imagePath] = imagePath;
        } else {
          // OPFS 文件名，获取 blob URL
          try {
            const url = await getImageBlobUrl(imagePath);
            if (url) urls[imagePath] = url;
          } catch { /* skip */ }
        }
      }
    }
    setImageUrls(urls);
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalRows / ROWS_PER_PAGE));

  // items 表的图片列渲染
  const renderCell = (colName: string, value: unknown) => {
    if (selectedTable === 'items' && colName === 'image_path') {
      const path = typeof value === 'string' ? value : '';
      if (!path) return <span style={{ color: '#6e6250' }}>—</span>;
      const url = imageUrls[path];
      if (!url) return <span style={{ color: '#8ec8b8' }}>加载中…</span>;
      return (
        <img
          src={url}
          alt=""
          style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 4, background: '#423825' }}
        />
      );
    }
    return formatCell(value);
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <h2>数据浏览</h2>

      <div className="dbrowser-layout">
        {/* 左侧表列表 */}
        <aside className="dbrowser-sidebar">
          <h3 style={{ fontSize: '0.85rem', color: '#8ec8b8', marginBottom: 8 }}>数据库表</h3>
          {tables.map((name) => (
            <button
              key={name}
              className={`dbrowser-table-btn${name === selectedTable ? ' active' : ''}`}
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
          {!selectedTable ? (
            <div className="empty-state">
              <span className="empty-icon">📊</span>
              <p>选择左侧的表查看数据</p>
            </div>
          ) : tableLoading ? (
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
              <div className="dbrowser-table-wrap">
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
                        <tr key={i}>
                          <td className="dbrowser-row-num">{page * ROWS_PER_PAGE + i + 1}</td>
                          {columns.map((col) => (
                            <td key={col.cid} className="dbrowser-cell">
                              {renderCell(col.name, row[col.name])}
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
