/** 归一化 service — 替代 normalization.py router
 *
 * 逻辑: 将该分类所有首饰 usage_count 减去当前最小值
 * 条件: 分类下 > 0 件首饰，且所有首饰 usage_count >= 1
 */

import type { Normalization } from '../../api/types';
import { getDBSync, markDirty } from '../database';

export function normalizeCategory(categoryId: number): Normalization {
  const db = getDBSync();

  // 1. 验证分类存在
  const catStmt = db.prepare('SELECT id FROM categories WHERE id = :id');
  catStmt.bind({ ':id': categoryId });
  if (!catStmt.step()) {
    catStmt.free();
    throw new Error(`分类 ${categoryId} 不存在`);
  }
  catStmt.free();

  // 2. 获取 min usage_count 和 count
  const statsStmt = db.prepare(
    'SELECT MIN(usage_count) AS min_usage, COUNT(*) AS cnt FROM items WHERE category_id = :id',
  );
  statsStmt.bind({ ':id': categoryId });
  statsStmt.step();
  const stats = statsStmt.getAsObject();
  statsStmt.free();

  if ((stats.cnt as number) === 0) {
    throw new Error('该分类下没有首饰，无法归一化');
  }
  if ((stats.min_usage as number) < 1) {
    throw new Error('存在未佩戴过的首饰，无法归一化');
  }

  const minRemoved = stats.min_usage as number;

  // 3. 所有首饰减去最小值
  db.run('UPDATE items SET usage_count = usage_count - :m WHERE category_id = :id', {
    ':m': minRemoved,
    ':id': categoryId,
  });

  // 4. 记录归一化历史
  db.run('INSERT INTO normalizations (category_id, min_removed) VALUES (:cid, :m)', {
    ':cid': categoryId,
    ':m': minRemoved,
  });
  const normId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number;

  markDirty();

  // 5. 查询返回
  const normStmt = db.prepare(
    'SELECT id, category_id, min_removed, created_at FROM normalizations WHERE id = :id',
  );
  normStmt.bind({ ':id': normId });
  normStmt.step();
  const row = normStmt.getAsObject();
  normStmt.free();

  return {
    id: row.id as number,
    category_id: row.category_id as number,
    min_removed: row.min_removed as number,
    created_at: row.created_at as string,
  };
}
