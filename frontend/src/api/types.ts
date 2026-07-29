/** 前端类型定义 — 与后端 Pydantic schemas 对应 */

// ── 分类 ────────────────────────────────────────────────────────

export interface Category {
  id: number;
  name_zh: string;
  sort_order: number;
}

export interface CategoryWithStats extends Category {
  item_count: number;
  can_normalize: boolean;
}

// ── 首饰 ────────────────────────────────────────────────────────

export interface Item {
  id: number;
  category_id: number;
  image_path: string | null;
  usage_count: number;
  created_at: string; // ISO datetime
}

// ── 每日佩戴 ────────────────────────────────────────────────────

export interface DailyWearItem {
  category_id: number;
  item_id: number;
}

export interface DailyWearCreate {
  items: DailyWearItem[];
}

// ── 佩戴记录 ────────────────────────────────────────────────────

export interface WearRecord {
  id: number;
  worn_at: string; // date
  created_at: string;
  items: Item[];
}

// ── 归一化 ──────────────────────────────────────────────────────

export interface Normalization {
  id: number;
  category_id: number;
  min_removed: number;
  created_at: string;
}

// ── 历史分页 ────────────────────────────────────────────────────

export interface HistoryPage {
  items: WearRecord[];
  total: number;
  page: number;
  page_size: number;
}
