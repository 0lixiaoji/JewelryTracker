/** API client — 原生 fetch 封装，每个 API 端点一个函数 */

import type {
  CategoryWithStats,
  DailyWearCreate,
  HistoryPage,
  Item,
  Normalization,
  WearRecord,
} from './types';

const BASE = '/api';

// ── 通用 fetch 封装 ──────────────────────────────────────────────

async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  // FormData 不手动设 Content-Type，让浏览器自动带 multipart boundary
  const headers: Record<string, string> = {};
  if (!(options?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail.detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── 分类 ─────────────────────────────────────────────────────────

export function fetchCategories(): Promise<CategoryWithStats[]> {
  return request('/categories');
}

export function fetchCategoryItems(categoryId: number): Promise<Item[]> {
  return request(`/categories/${categoryId}/items`);
}

// ── 首饰 CRUD ────────────────────────────────────────────────────

export function createItem(formData: FormData): Promise<Item> {
  return request('/items', {
    method: 'POST',
    body: formData,
  });
}

export function updateItem(
  itemId: number,
  categoryId: number,
): Promise<Item> {
  return request(`/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({ category_id: categoryId }),
  });
}

export function deleteItem(itemId: number): Promise<{ detail: string }> {
  return request(`/items/${itemId}`, { method: 'DELETE' });
}

// ── 每日佩戴 ─────────────────────────────────────────────────────

export function createDailyWear(body: DailyWearCreate): Promise<WearRecord> {
  return request('/daily-wear', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── 归一化 ───────────────────────────────────────────────────────

export function normalizeCategory(categoryId: number): Promise<Normalization> {
  return request(`/categories/${categoryId}/normalize`, { method: 'POST' });
}

// ── 历史 ─────────────────────────────────────────────────────────

export function fetchHistory(
  page: number = 1,
  pageSize: number = 20,
): Promise<HistoryPage> {
  return request(`/history?page=${page}&page_size=${pageSize}`);
}
