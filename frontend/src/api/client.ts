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
import { createItem as dbCreateItem, createItemsBatch as dbCreateItemsBatch, updateItem as dbUpdateItem, deleteItem as dbDeleteItem, replaceItemImage as dbReplaceItemImage } from '../db/services/items';
import { createDailyWear as dbCreateDailyWear, updateDailyWear as dbUpdateDailyWear, getWornItemsSinceLastNormalization as dbGetWornItemsSinceLastNormalization } from '../db/services/wear';
import { normalizeCategory as dbNormalizeCategory } from '../db/services/normalization';
import { listHistory as dbListHistory } from '../db/services/history';
import { initDatabase, getDBSync } from '../db/database';
import { getCategoryNextSequence, checkSequenceConflicts, saveImageBatch, isBase64, deleteImage, moveImageFile, parseSequenceFromFilename, parsePrefixFromFilename } from '../db/services/imageStore';
import { getCategoryFilePrefix } from '../constants/categorySubtypes';

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

/** 从数据库查询分类的 name_zh */
function lookupCategoryName(categoryId: number): string {
  const db = getDBSync();
  const result = db.exec('SELECT name_zh FROM categories WHERE id = ' + categoryId);
  if (!result.length || !result[0].values.length) {
    throw new Error(`分类 ${categoryId} 不存在`);
  }
  return result[0].values[0][0] as string;
}

// ── 分类 ─────────────────────────────────────────────────────────

export async function fetchCategories(): Promise<CategoryWithStats[]> {
  await ensureInit();
  return listCategories();
}

export async function fetchCategoryItems(
  categoryId: number,
  sortBy: 'number' | 'nameDesc' = 'number',
): Promise<Item[]> {
  await ensureInit();
  return getCategoryItems(categoryId, sortBy);
}

// ── 首饰 CRUD ────────────────────────────────────────────────────

export async function createItem(formData: FormData, subtypeName?: string, startSequence?: number): Promise<Item> {
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
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
  if (!allowedTypes.includes(imageFile.type) && imageFile.type !== '') {
    throw new Error(`不支持的图片格式: ${imageFile.type}`);
  }

  // 获取分类名称（若有细分类型则使用细分名作为文件前缀）
  const categoryName = subtypeName || lookupCategoryName(categoryId);

  // 获取编号：自定义起始编号 或 自动分配
  let sequences: number[];
  if (startSequence !== undefined) {
    sequences = [startSequence];
    const conflicts = await checkSequenceConflicts(categoryName, sequences);
    if (conflicts.length > 0) {
      throw new Error(`编号 ${conflicts.join(', ')} 已被占用，请换一个编号`);
    }
  } else {
    sequences = await getCategoryNextSequence(categoryName, 1);
  }

  try {
    // 优先写入 OPFS 文件存储
    const filenames = await saveImageBatch(categoryName, [imageFile], sequences);
    return dbCreateItem(categoryId, filenames[0]);
  } catch (fsErr) {
    // OPFS 不可用时 fallback 到 base64
    console.warn('OPFS 图片存储失败，降级为 base64:', fsErr);
    const base64 = await readFileAsBase64(imageFile);
    return dbCreateItem(categoryId, base64);
  }
}

export async function createItemsBatch(categoryId: number, files: File[], subtypeName?: string, startSequence?: number): Promise<Item[]> {
  await ensureInit();

  if (!categoryId || isNaN(categoryId)) {
    throw new Error('缺少分类 ID');
  }

  if (!files || files.length === 0) {
    throw new Error('缺少图片文件');
  }

  // 验证格式
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
  for (const f of files) {
    if (!allowedTypes.includes(f.type) && f.type !== '') {
      throw new Error(`不支持的图片格式: ${f.type}`);
    }
  }

  // 获取分类名称（若有细分类型则使用细分名作为文件前缀）
  const categoryName = subtypeName || lookupCategoryName(categoryId);

  // 获取编号：自定义起始编号 或 自动分配
  let sequences: number[];
  if (startSequence !== undefined) {
    sequences = Array.from({ length: files.length }, (_, i) => startSequence + i);
    const conflicts = await checkSequenceConflicts(categoryName, sequences);
    if (conflicts.length > 0) {
      throw new Error(`编号 ${conflicts.join(', ')} 已被占用，请换一个起始编号`);
    }
  } else {
    sequences = await getCategoryNextSequence(categoryName, files.length);
  }

  try {
    // 优先写入 OPFS 文件存储
    const filenames = await saveImageBatch(categoryName, files, sequences);
    return dbCreateItemsBatch(categoryId, filenames);
  } catch (fsErr) {
    // OPFS 不可用时 fallback 到 base64
    console.warn('OPFS 图片存储失败，降级为 base64:', fsErr);
    const base64s = await Promise.all(files.map((f) => readFileAsBase64(f)));
    return dbCreateItemsBatch(categoryId, base64s);
  }
}

export async function updateItem(
  itemId: number,
  categoryId: number,
): Promise<Item> {
  await ensureInit();

  // 移动分类：同步把 OPFS 文件名改为新分类前缀，
  // 否则源分类的编号仍被旧文件占用，且目标分类显示名带旧前缀
  const db = getDBSync();
  const stmt = db.prepare('SELECT id, category_id, image_path FROM items WHERE id = :id');
  stmt.bind({ ':id': itemId });
  if (!stmt.step()) throw new Error(`首饰 ${itemId} 不存在`);
  const row = stmt.getAsObject();
  stmt.free();

  const oldPath = row.image_path as string | null;
  let newPath: string | undefined;

  if (oldPath && !isBase64(oldPath)) {
    const newPrefix = getCategoryFilePrefix(lookupCategoryName(categoryId));
    const oldPrefix = parsePrefixFromFilename(oldPath);
    if (oldPrefix !== newPrefix) {
      const renamed = await moveImageFile(oldPath, newPrefix);
      if (renamed) newPath = renamed;
    }
  }

  return dbUpdateItem(itemId, categoryId, newPath);
}

export async function deleteItem(itemId: number): Promise<{ detail: string }> {
  await ensureInit();
  await dbDeleteItem(itemId);
  return { detail: `首饰 ${itemId} 已删除` };
}

export async function replaceItemImage(itemId: number, newFile: File): Promise<Item> {
  await ensureInit();

  // 1. 获取当前 item 信息
  const db = getDBSync();
  const stmt = db.prepare('SELECT id, category_id, image_path FROM items WHERE id = :id');
  stmt.bind({ ':id': itemId });
  if (!stmt.step()) throw new Error(`首饰 ${itemId} 不存在`);
  const row = stmt.getAsObject();
  stmt.free();

  const oldPath = row.image_path as string | null;
  const categoryId = row.category_id as number;

  // 2. 获取分类名
  const catResult = db.exec('SELECT name_zh FROM categories WHERE id = ' + categoryId);
  if (!catResult.length || !catResult[0].values.length) {
    throw new Error(`分类 ${categoryId} 不存在`);
  }
  const categoryName = catResult[0].values[0][0] as string;

  // 3. 处理新图片存储
  let newPath: string;
  if (oldPath && !isBase64(oldPath)) {
    // 旧的是 OPFS 文件 → 删旧写新，复用文件名
    try {
      await deleteImage(oldPath);
    } catch { /* 旧文件可能已不存在 */ }
    const seq = parseSequenceFromFilename(oldPath);
    const prefix = parsePrefixFromFilename(oldPath);
    const filenames = await saveImageBatch(prefix, [newFile], [seq]);
    newPath = filenames[0];
  } else {
    // 旧的是 base64 或无图片 → 写入 OPFS 新文件
    try {
      const sequences = await getCategoryNextSequence(categoryName, 1);
      const filenames = await saveImageBatch(categoryName, [newFile], sequences);
      newPath = filenames[0];
    } catch {
      // OPFS 不可用 → fallback base64
      newPath = await readFileAsBase64(newFile);
    }
  }

  // 4. 更新 DB（DB 存干净路径）
  const updated = await dbReplaceItemImage(itemId, newPath);
  // 追加缓存破坏参数，确保前端组件能检测到 src 变化并重新解析 blob URL
  return { ...updated, image_path: `${newPath}?t=${Date.now()}` };
}

// ── 每日佩戴 ─────────────────────────────────────────────────────

export async function createDailyWear(body: DailyWearCreate): Promise<WearRecord> {
  await ensureInit();
  return dbCreateDailyWear(body);
}

export async function updateDailyWear(recordId: number, body: DailyWearCreate): Promise<WearRecord> {
  await ensureInit();
  return dbUpdateDailyWear(recordId, body);
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

// ── 已佩戴查询 ───────────────────────────────────────────────────

/**
 * 查询每个分类中自上次归一化以来已佩戴过的首饰 ID 列表
 * 用于 DailyWear 页面展示「已佩戴」标记
 */
export async function fetchWornItemIds(): Promise<Record<number, number[]>> {
  await ensureInit();
  return dbGetWornItemsSinceLastNormalization();
}
