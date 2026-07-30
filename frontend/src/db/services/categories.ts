/** 分类 service — 替代 categories.py router */

import type { CategoryWithStats, Item } from '../../api/types';
import { getDBSync } from '../database';

// ── 辅助：将 SQLite 行转为前端类型 ───────────────────────────────

function rowToCategory(row: Record<string, unknown>): CategoryWithStats {
  return {
    id: row.id as number,
    name_zh: row.name_zh as string,
    sort_order: row.sort_order as number,
    item_count: (row.item_count as number) ?? 0,
    can_normalize: (row.can_normalize as number) === 1,
  };
}

function rowToItem(row: Record<string, unknown>): Item {
  return {
    id: row.id as number,
    category_id: row.category_id as number,
    image_path: (row.image_path as string) ?? null,
    usage_count: row.usage_count as number,
    created_at: row.created_at as string,
  };
}

// ── 查询 ──────────────────────────────────────────────────────────

export function listCategories(): CategoryWithStats[] {
  const db = getDBSync();
  const stmt = db.prepare(`
    SELECT
      c.id,
      c.name_zh,
      c.sort_order,
      COUNT(i.id) AS item_count,
      CASE
        WHEN COUNT(i.id) > 0 AND MIN(i.usage_count) >= 1 THEN 1
        ELSE 0
      END AS can_normalize
    FROM categories c
    LEFT JOIN items i ON i.category_id = c.id
    GROUP BY c.id
    ORDER BY c.sort_order
  `);
  const rows: CategoryWithStats[] = [];
  while (stmt.step()) {
    rows.push(rowToCategory(stmt.getAsObject()));
  }
  stmt.free();
  return rows;
}

export function getCategoryItems(categoryId: number): Item[] {
  const db = getDBSync();
  const stmt = db.prepare(
    `SELECT id, category_id, image_path, usage_count, created_at
     FROM items
     WHERE category_id = :catId
     ORDER BY created_at DESC`,
  );
  stmt.bind({ ':catId': categoryId });
  const rows: Item[] = [];
  while (stmt.step()) {
    rows.push(rowToItem(stmt.getAsObject()));
  }
  stmt.free();
  return rows;
}

export function getCategoryById(categoryId: number): Record<string, unknown> | null {
  const db = getDBSync();
  const stmt = db.prepare('SELECT id, name_zh, sort_order FROM categories WHERE id = :id');
  stmt.bind({ ':id': categoryId });
  let result: Record<string, unknown> | null = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}
