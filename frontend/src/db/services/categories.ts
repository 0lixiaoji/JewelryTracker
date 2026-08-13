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

// ── 辅助：从 image_path 提取排序键 ──────────────────────────────
//
// image_path 格式: {前缀}_{编号}.{扩展名}
// - 无 subtype: "发圈_1.jpg"        → prefix="发圈",   num=1
// - 有 subtype: "耳环_h_3.jpg"      → prefix="耳环_h", num=3
// - 无法解析:   null / base64       → 排在最后
//
// 排序规则: 先按 prefix 字母序，再按 num 数字序

interface SortParts {
  prefix: string;
  num: number;
}

function parseSortParts(imagePath: string | null): SortParts {
  if (!imagePath) return { prefix: '￿', num: 0 };
  if (imagePath.startsWith('data:')) return { prefix: '￿', num: 0 };

  // 去掉扩展名，再按最后一个 _ 拆分为 prefix 和 num
  const dotIdx = imagePath.lastIndexOf('.');
  const nameWithoutExt = dotIdx > 0 ? imagePath.slice(0, dotIdx) : imagePath;

  const lastUnderscoreIdx = nameWithoutExt.lastIndexOf('_');
  if (lastUnderscoreIdx < 0) {
    return { prefix: nameWithoutExt, num: 0 };
  }

  const prefix = nameWithoutExt.slice(0, lastUnderscoreIdx);
  const num = parseInt(nameWithoutExt.slice(lastUnderscoreIdx + 1), 10);

  return { prefix, num: isNaN(num) ? Infinity : num };
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

/** 查询某分类下的首饰
 *  sortBy: 'number'（默认）按编号升序（每日佩戴页用）；'newest' 按录入时间倒序（分类详情页用）
 */
export function getCategoryItems(
  categoryId: number,
  sortBy: 'number' | 'newest' = 'number',
): Item[] {
  const db = getDBSync();
  const stmt = db.prepare(
    `SELECT id, category_id, image_path, usage_count, created_at
     FROM items
     WHERE category_id = :catId`,
  );
  stmt.bind({ ':catId': categoryId });
  const rows: Item[] = [];
  while (stmt.step()) {
    rows.push(rowToItem(stmt.getAsObject()));
  }
  stmt.free();

  if (sortBy === 'newest') {
    // 按录入时间倒序（最新录入在前），id 作为同秒并列时的稳定次序；
    // created_at 为 NULL 的项（旧数据）排在最后
    rows.sort((a, b) => {
      const ta = a.created_at ?? '';
      const tb = b.created_at ?? '';
      if (ta !== tb) return ta > tb ? -1 : 1;
      return b.id - a.id;
    });
  } else {
    // 按 prefix 字母序 → num 数字序升序排列，
    // 无法解析的项（null / base64）排到最后
    rows.sort((a, b) => {
      const pa = parseSortParts(a.image_path);
      const pb = parseSortParts(b.image_path);
      const prefixCmp = pa.prefix.localeCompare(pb.prefix);
      if (prefixCmp !== 0) return prefixCmp;
      return pa.num - pb.num;
    });
  }

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
