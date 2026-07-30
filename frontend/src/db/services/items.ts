/** 首饰 service — 替代 items.py router
 *
 * 与后端的差异:
 * - 图片存储: 后端存文件路径 → 这里存 base64 data URL 到 SQLite
 * - createItem: 后端接收 FormData → 这里接收 categoryId + base64Image
 */

import type { Item } from '../../api/types';
import { getDBSync, markDirty } from '../database';

// ── 辅助 ──────────────────────────────────────────────────────────

function rowToItem(row: Record<string, unknown>): Item {
  return {
    id: row.id as number,
    category_id: row.category_id as number,
    image_path: (row.image_path as string) ?? null,
    usage_count: row.usage_count as number,
    created_at: row.created_at as string,
  };
}

function getItemById(db: ReturnType<typeof getDBSync>, itemId: number): Record<string, unknown> | null {
  const stmt = db.prepare(
    'SELECT id, category_id, image_path, usage_count, created_at FROM items WHERE id = :id',
  );
  stmt.bind({ ':id': itemId });
  let row: Record<string, unknown> | null = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

// ── CRUD ──────────────────────────────────────────────────────────

export function createItem(categoryId: number, imageBase64: string): Item {
  const db = getDBSync();

  // 验证分类存在
  const cat = db.exec('SELECT id FROM categories WHERE id = ' + categoryId);
  if (!cat.length || !cat[0].values.length) {
    throw new Error(`分类 ${categoryId} 不存在`);
  }

  db.run('INSERT INTO items (category_id, image_path) VALUES (:catId, :img)', {
    ':catId': categoryId,
    ':img': imageBase64,
  });

  const newId = db.exec('SELECT last_insert_rowid() AS id')[0].values[0][0] as number;
  markDirty();

  const row = getItemById(db, newId)!;
  return rowToItem(row);
}

export function updateItem(itemId: number, categoryId: number): Item {
  const db = getDBSync();

  const existing = getItemById(db, itemId);
  if (!existing) throw new Error(`首饰 ${itemId} 不存在`);

  // 验证新分类存在
  const cat = db.exec('SELECT id FROM categories WHERE id = ' + categoryId);
  if (!cat.length || !cat[0].values.length) {
    throw new Error(`分类 ${categoryId} 不存在`);
  }

  db.run('UPDATE items SET category_id = :catId WHERE id = :id', {
    ':catId': categoryId,
    ':id': itemId,
  });
  markDirty();

  const row = getItemById(db, itemId)!;
  return rowToItem(row);
}

export function deleteItem(itemId: number): void {
  const db = getDBSync();

  const existing = getItemById(db, itemId);
  if (!existing) throw new Error(`首饰 ${itemId} 不存在`);

  db.run('DELETE FROM items WHERE id = :id', { ':id': itemId });
  markDirty();
}
