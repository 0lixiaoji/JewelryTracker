/** sql.js 数据库初始化 + OPFS 持久化
 *
 * 流程:
 * 1. 加载 sql.js WASM
 * 2. 尝试从 OPFS 恢复已保存的数据库
 * 3. 如果没有，创建新数据库 + 执行迁移脚本
 * 4. 每次写操作后自动保存到 OPFS
 */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { INIT_SQL } from './migration';

// ── OPFS 存储配置 ─────────────────────────────────────────────────

const DB_FILENAME = 'jewelry-tracker.db';
const DB_META_KEY = 'jewelry_db_version';
const DB_VERSION = 1;

// ── 全局单例 ──────────────────────────────────────────────────────

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let initPromise: Promise<Database> | null = null;
let dirty = false;

// ── OPFS 读写 ─────────────────────────────────────────────────────

async function getOPFSHandle(): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getFileHandle(DB_FILENAME, { create: true });
}

async function saveToOPFS(): Promise<void> {
  if (!db) return;
  try {
    const data = db.export();
    const handle = await getOPFSHandle();
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    dirty = false;
  } catch (err) {
    console.warn('OPFS 保存失败，尝试 IndexedDB 回退:', err);
    await saveToIndexedDB();
  }
}

async function loadFromOPFS(): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(DB_FILENAME);
    const file = await handle.getFile();
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

// ── IndexedDB 回退（OPFS 不可用时）────────────────────────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('JewelryTracker', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('db', { keyPath: 'name' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToIndexedDB(): Promise<void> {
  if (!db) return;
  const data = db.export();
  const idb = await openIDB();
  const tx = idb.transaction('db', 'readwrite');
  tx.objectStore('db').put({ name: DB_FILENAME, data, version: DB_VERSION });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  idb.close();
  dirty = false;
}

async function loadFromIndexedDB(): Promise<Uint8Array | null> {
  try {
    const idb = await openIDB();
    const result = await new Promise<{ name: string; data: Uint8Array; version: number } | undefined>(
      (resolve) => {
        const req = idb.transaction('db', 'readonly').objectStore('db').get(DB_FILENAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      },
    );
    idb.close();
    if (result && result.version === DB_VERSION) {
      return result.data;
    }
    return null;
  } catch {
    return null;
  }
}

// ── 初始化 ────────────────────────────────────────────────────────

export async function initDatabase(): Promise<Database> {
  // 避免重复初始化
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // 加载 sql.js WASM（Vite 会处理 .wasm 文件）
    SQL = await initSqlJs({
      locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
    });

    // 尝试恢复已有数据库
    let saved = await loadFromOPFS();
    if (!saved) {
      saved = await loadFromIndexedDB();
    }

    if (saved && saved.length > 0) {
      // 恢复已有数据库
      db = new SQL.Database(saved);
      // 验证数据库完整性
      try {
        db.exec('SELECT 1 FROM categories');
      } catch {
        // 数据库损坏，重新创建
        console.warn('数据库损坏，重新初始化...');
        db.close();
        db = createFresh();
      }
    } else {
      // 首次启动，创建新数据库
      db = createFresh();
    }

    return db;
  })();

  return initPromise;
}

function createFresh(): Database {
  if (!SQL) throw new Error('sql.js 未加载');
  const database = new SQL.Database();
  database.run('PRAGMA foreign_keys = ON');
  database.exec(INIT_SQL);
  // 标记需要保存
  dirty = true;
  saveSnapshot();
  localStorage.setItem(DB_META_KEY, String(DB_VERSION));
  return database;
}

// ── 获取数据库实例 ────────────────────────────────────────────────

export async function getDB(): Promise<Database> {
  if (db) return db;
  return initDatabase();
}

/** 同步获取（仅在 initDatabase 完成后可用） */
export function getDBSync(): Database {
  if (!db) throw new Error('数据库未初始化，请先调用 initDatabase()');
  return db;
}

// ── 持久化 ────────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 标记脏数据，延迟保存（防抖 1 秒） */
export function markDirty(): void {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSnapshot(), 1000);
}

/** 立即保存 */
export async function saveSnapshot(): Promise<void> {
  if (!db || !dirty) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // 优先 OPFS，失败回退 IndexedDB
  await saveToOPFS().catch(() => saveToIndexedDB());
}

/** 页面卸载前强制保存 */
export function setupAutoSave(): void {
  // 页面隐藏/关闭时保存
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) {
      saveToOPFS().catch(() => saveToIndexedDB());
    }
  });

  // beforeunload 时同步保存（使用 sendBeacon 风格）
  window.addEventListener('beforeunload', () => {
    if (db && dirty) {
      try {
        const data = db.export();
        // 同步写 IndexedDB（OPFS 不支持同步）
        const req = indexedDB.open('JewelryTracker', 1);
        req.onsuccess = () => {
          const tx = req.result.transaction('db', 'readwrite');
          tx.objectStore('db').put({ name: DB_FILENAME, data, version: DB_VERSION });
        };
        // 也尝试 OPFS（可能来不及，但尽力而为）
        navigator.storage.getDirectory().then((root) => {
          root.getFileHandle(DB_FILENAME, { create: true }).then((handle) => {
            handle.createWritable().then((w) => {
              w.write(data);
              w.close();
            });
          });
        });
      } catch {
        // 静默失败
      }
    }
  });
}
