/** 每日佩戴 service — 替代 daily_wear.py router
 *
 * 逻辑流程:
 * 1. 校验分类不重复
 * 2. 校验每个 item 存在且分类匹配
 * 3. 创建 wear_record
 * 4. 写入 wear_record_items
 * 5. 增加每件首饰 usage_count
 */

import type { DailyWearCreate, WearRecord } from '../../api/types';
import { getDBSync, markDirty } from '../database';

function rowToItem(row: Record<string, unknown>) {
  return {
    id: row.id as number,
    category_id: row.category_id as number,
    image_path: (row.image_path as string) ?? null,
    usage_count: row.usage_count as number,
    created_at: row.created_at as string,
  };
}

export function createDailyWear(body: DailyWearCreate): WearRecord {
  const db = getDBSync();

  // 1. 校验没有重复分类
  const categoryIds = body.items.map((item) => item.category_id);
  if (new Set(categoryIds).size !== categoryIds.length) {
    throw new Error('每类首饰每天最多选择 1 件');
  }

  // 2. 校验每个 item 存在且分类匹配
  for (const { item_id, category_id } of body.items) {
    const stmt = db.prepare('SELECT id, category_id FROM items WHERE id = :id');
    stmt.bind({ ':id': item_id });
    if (!stmt.step()) {
      stmt.free();
      throw new Error(`首饰 ${item_id} 不存在`);
    }
    const row = stmt.getAsObject();
    stmt.free();
    if (row.category_id !== category_id) {
      throw new Error(`首饰 ${item_id} 不属于分类 ${category_id}`);
    }
  }

  // 3. 创建佩戴记录
  db.run("INSERT INTO wear_records (worn_at) VALUES (date('now', 'localtime'))");
  const wearRecordId = (db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number);

  // 4. 写入佩戴明细
  for (const { item_id } of body.items) {
    db.run('INSERT INTO wear_record_items (wear_record_id, item_id) VALUES (:rid, :iid)', {
      ':rid': wearRecordId,
      ':iid': item_id,
    });
  }

  // 5. 增加 usage_count
  for (const { item_id } of body.items) {
    db.run('UPDATE items SET usage_count = usage_count + 1 WHERE id = :id', {
      ':id': item_id,
    });
  }

  markDirty();

  // 6. 查询完整记录返回
  const recordStmt = db.prepare('SELECT id, worn_at, created_at FROM wear_records WHERE id = :id');
  recordStmt.bind({ ':id': wearRecordId });
  recordStmt.step();
  const record = recordStmt.getAsObject();
  recordStmt.free();

  // 查询关联的首饰
  const itemIds = body.items.map((i) => i.item_id);
  const items: ReturnType<typeof rowToItem>[] = [];
  for (const iid of itemIds) {
    const s = db.prepare(
      'SELECT id, category_id, image_path, usage_count, created_at FROM items WHERE id = :id',
    );
    s.bind({ ':id': iid });
    if (s.step()) items.push(rowToItem(s.getAsObject()));
    s.free();
  }

  return {
    id: record.id as number,
    worn_at: record.worn_at as string,
    created_at: record.created_at as string,
    items,
  };
}
