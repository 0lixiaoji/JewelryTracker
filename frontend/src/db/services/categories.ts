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
const UNPARSEABLE = '￿'; // 无法解析项（null / base64）的排序哨兵，始终排在最后

interface SortParts {
  prefix: string;
  num: number;
}

function parseSortParts(imagePath: string | null): SortParts {
  if (!imagePath) return { prefix: UNPARSEABLE, num: 0 };
  if (imagePath.startsWith('data:')) return { prefix: UNPARSEABLE, num: 0 };

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

/** 名称倒序比较：prefix 字母序倒序 → num 数字序倒序；无法解析项（null/base64）最后 */
function compareNameDesc(a: Item, b: Item): number {
  const pa = parseSortParts(a.image_path);
  const pb = parseSortParts(b.image_path);
  const aLast = pa.prefix === UNPARSEABLE;
  const bLast = pb.prefix === UNPARSEABLE;
  if (aLast !== bLast) return aLast ? 1 : -1;
  const prefixCmp = pb.prefix.localeCompare(pa.prefix);
  if (prefixCmp !== 0) return prefixCmp;
  return pb.num - pa.num;
}

/**
 * 名称倒序 + 双类型交错排布
 *
 * 手链/耳环这类「由两种类型组成」的分类（手链+手镯、耳环_h+耳环_s），
 * 各类型先按名称倒序排好，再按「多的两列、少的一列」交错成平铺数组：
 *   行0 = [多_1st, 多_2nd, 少_1st]  → 首行即同时出现两种类型的排序第一
 *   行1 = [多_3rd, 多_4th, 少_2nd]  ...
 * 普通单类型分类保持原名称倒序不变。
 */
function interleaveNameDesc(rows: Item[]): Item[] {
  // 1. 按文件前缀分组；无法解析的（null / base64）归入末尾
  const groups = new Map<string, Item[]>();
  const unparseable: Item[] = [];
  for (const row of rows) {
    const prefix = parseSortParts(row.image_path).prefix;
    if (prefix === UNPARSEABLE) {
      unparseable.push(row);
    } else {
      const arr = groups.get(prefix);
      if (arr) arr.push(row);
      else groups.set(prefix, [row]);
    }
  }

  // 2. 类型数非 2（单类型或异常多类型）→ 维持原倒序兜底
  const groupList = [...groups.values()];
  if (groupList.length !== 2) {
    rows.sort(compareNameDesc);
    return rows;
  }

  // 3. 双类型：数量多的两列在前，少的单列在后；组内按编号倒序
  const [major, minor] = [...groupList].sort((x, y) => y.length - x.length);
  major.sort((a, b) => parseSortParts(b.image_path).num - parseSortParts(a.image_path).num);
  minor.sort((a, b) => parseSortParts(b.image_path).num - parseSortParts(a.image_path).num);

  const result: Item[] = [];
  const maxRows = Math.max(Math.ceil(major.length / 2), minor.length);
  for (let r = 0; r < maxRows; r++) {
    if (r * 2 < major.length) result.push(major[r * 2]);
    if (r * 2 + 1 < major.length) result.push(major[r * 2 + 1]);
    if (r < minor.length) result.push(minor[r]);
  }
  result.push(...unparseable);
  return result;
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
 *  sortBy: 'number'（默认）按编号升序（每日佩戴页用）；'nameDesc' 按名称倒序（分类详情页用）
 */
export function getCategoryItems(
  categoryId: number,
  sortBy: 'number' | 'nameDesc' = 'number',
): Item[] {
  const db = getDBSync();
  const stmt = db.prepare(
    `SELECT id, category_id, image_path, usage_count, created_at
     FROM items
     WHERE category_id = :catId`,
  );
  stmt.bind({ ':catId': categoryId });
  let rows: Item[] = [];
  while (stmt.step()) {
    rows.push(rowToItem(stmt.getAsObject()));
  }
  stmt.free();

  if (sortBy === 'nameDesc') {
    // 名称倒序排列；双类型分类（手链/耳环）额外按「多的两列、少的一列」交错，
    // 让两种类型的排序第一同时出现在首行
    rows = interleaveNameDesc(rows);
  } else {
    // 'number'：按 prefix 字母序 → num 数字序升序排列，
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
