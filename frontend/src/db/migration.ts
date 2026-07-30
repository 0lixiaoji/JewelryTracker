/** SQLite 建表迁移 — 从 MySQL migration.sql 翻译
 *
 * 关键差异:
 * - AUTO_INCREMENT → INTEGER PRIMARY KEY AUTOINCREMENT
 * - CURRENT_DATE/CURRENT_TIMESTAMP → date('now','localtime') / datetime('now','localtime')
 * - ENGINE/CHARSET/COLLATE 全部移除（SQLite 不需要）
 * - FOREIGN KEY 需 PRAGMA foreign_keys = ON 才能生效
 */

export const MIGRATION_SQL = `
-- 1. 分类表（固定 9 个分类）
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_zh TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- 2. 首饰表（纯图片辨认，无名称，图片存为 base64）
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    image_path TEXT DEFAULT NULL,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_category ON items(category_id);

-- 3. 佩戴记录表
CREATE TABLE IF NOT EXISTS wear_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worn_at TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_worn_at ON wear_records(worn_at);

-- 4. 佩戴明细表（关联首饰）
CREATE TABLE IF NOT EXISTS wear_record_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wear_record_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    FOREIGN KEY (wear_record_id) REFERENCES wear_records(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    UNIQUE (wear_record_id, item_id)
);

-- 5. 归一化历史表
CREATE TABLE IF NOT EXISTS normalizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    min_removed INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);
`;

/** 种子数据 — 9 个分类，与 MySQL 版本完全一致 */
export const SEED_SQL = `
INSERT OR IGNORE INTO categories (id, name_zh, sort_order) VALUES
    (1, '发圈', 2),
    (2, '发卡', 1),
    (3, '眼影', 3),
    (4, '耳环', 4),
    (5, '口红', 5),
    (6, '项链', 6),
    (7, '手链', 7),
    (8, '戒指', 8),
    (9, '盒子', 9);
`;

/** 建表 + 种子数据，一次执行 */
export const INIT_SQL = `
PRAGMA foreign_keys = ON;
${MIGRATION_SQL}
${SEED_SQL}
`;

/** 增量迁移 — 按版本号顺序执行，每个只执行一次
 *  新迁移追加到数组末尾，版本号递增 */
export interface Migration {
  version: number;
  description: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    description: '发卡排在发圈前面',
    sql: `UPDATE categories SET sort_order = 2 WHERE id = 1 AND sort_order = 1;
          UPDATE categories SET sort_order = 1 WHERE id = 2 AND sort_order = 2;`,
  },
];
