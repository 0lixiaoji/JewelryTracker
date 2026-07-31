/** 每日佩戴 service — 替代 daily_wear.py router
 *
 * createDailyWear 逻辑流程:
 * 1. 校验分类不重复
 * 2. 校验每个 item 存在且分类匹配
 * 3. 创建 wear_record
 * 4. 写入 wear_record_items
 * 5. 增加每件首饰 usage_count
 *
 * updateDailyWear 逻辑流程:
 * 1. 校验记录存在且为今天
 * 2. 校验分类不重复 + item 有效性
 * 3. 回退旧首饰 usage_count
 * 4. 删除旧 wear_record_items
 * 5. 写入新 wear_record_items
 * 6. 增加新首饰 usage_count
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

/** 校验佩戴请求的合法性 */
function validateDailyWearBody(db: ReturnType<typeof getDBSync>, body: DailyWearCreate) {
  const categoryIds = body.items.map((item) => item.category_id);
  if (new Set(categoryIds).size !== categoryIds.length) {
    throw new Error('每类首饰每天最多选择 1 件');
  }

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
}

/** 查询完整佩戴记录（含首饰详情） */
function queryWearRecord(
  db: ReturnType<typeof getDBSync>,
  recordId: number,
  itemIds: number[],
): WearRecord {
  const recordStmt = db.prepare('SELECT id, worn_at, created_at FROM wear_records WHERE id = :id');
  recordStmt.bind({ ':id': recordId });
  recordStmt.step();
  const record = recordStmt.getAsObject();
  recordStmt.free();

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

export function createDailyWear(body: DailyWearCreate): WearRecord {
  const db = getDBSync();

  validateDailyWearBody(db, body);

  // 创建佩戴记录
  db.run("INSERT INTO wear_records (worn_at) VALUES (date('now', 'localtime'))");
  const wearRecordId = (db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number);

  // 写入佩戴明细
  for (const { item_id } of body.items) {
    db.run('INSERT INTO wear_record_items (wear_record_id, item_id) VALUES (:rid, :iid)', {
      ':rid': wearRecordId,
      ':iid': item_id,
    });
  }

  // 增加 usage_count
  for (const { item_id } of body.items) {
    db.run('UPDATE items SET usage_count = usage_count + 1 WHERE id = :id', {
      ':id': item_id,
    });
  }

  markDirty();

  return queryWearRecord(db, wearRecordId, body.items.map((i) => i.item_id));
}

/** 修改今日佩戴记录 — 替换已选首饰，自动调整 usage_count */
export function updateDailyWear(recordId: number, body: DailyWearCreate): WearRecord {
  const db = getDBSync();

  // 1. 校验记录存在且 worn_at 为今天
  const todayStmt = db.prepare(
    "SELECT id, worn_at FROM wear_records WHERE id = :id AND worn_at = date('now', 'localtime')",
  );
  todayStmt.bind({ ':id': recordId });
  if (!todayStmt.step()) {
    todayStmt.free();
    throw new Error('今日佩戴记录不存在或不是今天的记录');
  }
  todayStmt.free();

  // 2. 校验新数据
  validateDailyWearBody(db, body);

  // 3. 查出旧明细，回退 usage_count
  const oldStmt = db.prepare(
    'SELECT item_id FROM wear_record_items WHERE wear_record_id = :rid',
  );
  oldStmt.bind({ ':rid': recordId });
  const oldItemIds: number[] = [];
  while (oldStmt.step()) {
    oldItemIds.push(oldStmt.getAsObject().item_id as number);
  }
  oldStmt.free();

  for (const oid of oldItemIds) {
    db.run('UPDATE items SET usage_count = usage_count - 1 WHERE id = :id', { ':id': oid });
  }

  // 4. 删除旧明细
  db.run('DELETE FROM wear_record_items WHERE wear_record_id = :rid', { ':rid': recordId });

  // 5. 写入新明细
  for (const { item_id } of body.items) {
    db.run('INSERT INTO wear_record_items (wear_record_id, item_id) VALUES (:rid, :iid)', {
      ':rid': recordId,
      ':iid': item_id,
    });
  }

  // 6. 增加新首饰 usage_count
  for (const { item_id } of body.items) {
    db.run('UPDATE items SET usage_count = usage_count + 1 WHERE id = :id', { ':id': item_id });
  }

  markDirty();

  return queryWearRecord(db, recordId, body.items.map((i) => i.item_id));
}
