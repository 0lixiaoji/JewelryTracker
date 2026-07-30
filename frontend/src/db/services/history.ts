/** 历史 service — 替代 history.py router
 *
 * 按日期倒序分页查询佩戴记录 + 关联首饰
 */

import type { HistoryPage, Item, WearRecord } from '../../api/types';
import { getDBSync } from '../database';

export function listHistory(page: number = 1, pageSize: number = 20): HistoryPage {
  const db = getDBSync();

  // 1. 总数
  const totalResult = db.exec('SELECT COUNT(*) AS total FROM wear_records');
  const total = (totalResult[0]?.values[0]?.[0] as number) ?? 0;

  // 2. 分页查询佩戴记录
  const offset = (page - 1) * pageSize;
  const recordStmt = db.prepare(
    'SELECT id, worn_at, created_at FROM wear_records ORDER BY worn_at DESC, created_at DESC LIMIT :limit OFFSET :offset',
  );
  recordStmt.bind({ ':limit': pageSize, ':offset': offset });
  const records: Array<{ id: number; worn_at: string; created_at: string }> = [];
  while (recordStmt.step()) {
    const r = recordStmt.getAsObject();
    records.push({
      id: r.id as number,
      worn_at: r.worn_at as string,
      created_at: r.created_at as string,
    });
  }
  recordStmt.free();

  if (records.length === 0) {
    return { items: [], total, page, page_size: pageSize };
  }

  // 3. 批量查询所有记录的首饰明细
  const recordIds = records.map((r) => r.id);
  const itemsMap = new Map<number, Item[]>();

  for (const rid of recordIds) {
    const s = db.prepare(
      `SELECT i.id, i.category_id, i.image_path, i.usage_count, i.created_at
       FROM wear_record_items wri
       JOIN items i ON i.id = wri.item_id
       WHERE wri.wear_record_id = :rid`,
    );
    s.bind({ ':rid': rid });
    const items: Item[] = [];
    while (s.step()) {
      const row = s.getAsObject();
      items.push({
        id: row.id as number,
        category_id: row.category_id as number,
        image_path: (row.image_path as string) ?? null,
        usage_count: row.usage_count as number,
        created_at: row.created_at as string,
      });
    }
    s.free();
    itemsMap.set(rid, items);
  }

  // 4. 组装响应
  const result: WearRecord[] = records.map((r) => ({
    id: r.id,
    worn_at: r.worn_at,
    created_at: r.created_at,
    items: itemsMap.get(r.id) ?? [],
  }));

  return { items: result, total, page, page_size: pageSize };
}
