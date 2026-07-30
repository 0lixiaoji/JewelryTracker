/** API client — 本地 sql.js 数据库调用（原 HTTP fetch → 本地 service）
 *
 * PWA 模式下所有数据存在浏览器本地 SQLite，不需要后端。
 * 函数签名保持不变，现有页面组件无需改动。
 */

import type {
  CategoryWithStats,
  DailyWearCreate,
  HistoryPage,
  Item,
  Normalization,
  WearRecord,
} from './types';

import { listCategories, getCategoryItems } from '../db/services/categories';
import { createItem as dbCreateItem, updateItem as dbUpdateItem, deleteItem as dbDeleteItem } from '../db/services/items';
import { createDailyWear as dbCreateDailyWear } from '../db/services/wear';
import { normalizeCategory as dbNormalizeCategory } from '../db/services/normalization';
import { listHistory as dbListHistory } from '../db/services/history';
import { initDatabase } from '../db/database';

// ── 初始化标记 ────────────────────────────────────────────────────

let initialized = false;

async function ensureInit(): Promise<void> {
  if (!initialized) {
    await initDatabase();
    initialized = true;
  }
}

// ── 辅助：读取 File 为 base64 ─────────────────────────────────────

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

// ── 分类 ─────────────────────────────────────────────────────────

export async function fetchCategories(): Promise<CategoryWithStats[]> {
  await ensureInit();
  return listCategories();
}

export async function fetchCategoryItems(categoryId: number): Promise<Item[]> {
  await ensureInit();
  return getCategoryItems(categoryId);
}

// ── 首饰 CRUD ────────────────────────────────────────────────────

export async function createItem(formData: FormData): Promise<Item> {
  await ensureInit();

  const categoryId = Number(formData.get('category_id'));
  if (!categoryId || isNaN(categoryId)) {
    throw new Error('缺少分类 ID');
  }

  const imageFile = formData.get('image');
  if (!(imageFile instanceof File)) {
    throw new Error('缺少图片文件');
  }

  // 验证格式
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
  if (!allowedTypes.includes(imageFile.type) && imageFile.type !== '') {
    throw new Error(`不支持的图片格式: ${imageFile.type}`);
  }

  const base64 = await readFileAsBase64(imageFile);
  return dbCreateItem(categoryId, base64);
}

export async function updateItem(
  itemId: number,
  categoryId: number,
): Promise<Item> {
  await ensureInit();
  return dbUpdateItem(itemId, categoryId);
}

export async function deleteItem(itemId: number): Promise<{ detail: string }> {
  await ensureInit();
  dbDeleteItem(itemId);
  return { detail: `首饰 ${itemId} 已删除` };
}

// ── 每日佩戴 ─────────────────────────────────────────────────────

export async function createDailyWear(body: DailyWearCreate): Promise<WearRecord> {
  await ensureInit();
  return dbCreateDailyWear(body);
}

// ── 归一化 ───────────────────────────────────────────────────────

export async function normalizeCategory(categoryId: number): Promise<Normalization> {
  await ensureInit();
  return dbNormalizeCategory(categoryId);
}

// ── 历史 ─────────────────────────────────────────────────────────

export async function fetchHistory(
  page: number = 1,
  pageSize: number = 20,
): Promise<HistoryPage> {
  await ensureInit();
  return dbListHistory(page, pageSize);
}
