/** sql.js 数据库初始化 + OPFS 持久化
 *
 * 流程:
 * 1. 加载 sql.js WASM
 * 2. 尝试从 OPFS 恢复已保存的数据库
 * 3. 如果没有，创建新数据库 + 执行迁移脚本
 * 4. 每次写操作后自动保存到 OPFS
 */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { INIT_SQL, MIGRATIONS } from './migration';
import { nativeSaveAndShare } from '../capacitor/index';
import { initImageStore } from './services/imageStore';

// ── OPFS 存储配置 ─────────────────────────────────────────────────

const DB_FILENAME = 'jewelry-tracker.db';
const DB_META_KEY = 'jewelry_db_version';
const DB_VERSION = 1; // schema version, track via localStorage key suffix

/** 执行未应用的增量迁移 */
function runMigrations(database: Database): void {
  // 用 localStorage 追踪已应用的迁移版本
  const appliedKey = `${DB_META_KEY}_migrations`;
  const applied: number[] = JSON.parse(localStorage.getItem(appliedKey) ?? '[]');

  for (const m of MIGRATIONS) {
    if (applied.includes(m.version)) continue;
    try {
      database.exec(m.sql);
      applied.push(m.version);
      console.log(`Migration v${m.version}: ${m.description} ✓`);
    } catch (err) {
      console.warn(`Migration v${m.version} failed:`, err);
    }
  }
  localStorage.setItem(appliedKey, JSON.stringify(applied));
}

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
      locateFile: (file: string) => `${import.meta.env.BASE_URL}${file.replace('sql-wasm.wasm', 'sql-wasm-browser.wasm')}`,
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

    // 执行增量迁移
    runMigrations(db);

    // 初始化图片文件存储目录
    await initImageStore();

    return db;
  })();

  return initPromise;
}

function createFresh(): Database {
  if (!SQL) throw new Error('sql.js 未加载');
  const database = new SQL.Database();
  database.run('PRAGMA foreign_keys = ON');
  database.exec(INIT_SQL);
  // 先赋值给模块级变量，再保存（saveSnapshot 依赖 db 非 null）
  db = database;
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

// ── 导出 / 导入 ──────────────────────────────────────────────────

/**
 * 导出数据库为文件。
 *
 * - **Capacitor 原生**：使用 Filesystem + Share 调用系统分享面板。
 * - **Web 模式**：走 localStorage + export.html 的下载流程，返回 URL 供新窗口打开。
 *
 * @returns 如果是 Web 模式返回 export.html 的 URL；原生模式返回 null（已通过分享处理）
 */
export async function exportDatabase(): Promise<string | null> {
  const database = getDBSync();
  const data = database.export();
  const bytes = new Uint8Array(data);
  const filename = `jewelry-backup-${new Date().toISOString().slice(0, 10)}.db`;

  // 尝试原生分享
  const handled = await nativeSaveAndShare(bytes, filename);
  if (handled) return null;

  // Web 降级：转 base64 存 localStorage，供 export.html 读取
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  localStorage.setItem('jewelry_export_data', base64);
  localStorage.setItem('jewelry_export_filename', filename);

  // 使用 URL 构造函数正确解析相对路径（兼容 Capacitor file:// 协议）
  return new URL(`${import.meta.env.BASE_URL}export.html`, window.location.href).href;
}

/** 导入数据库文件，替换当前数据库 */
export async function importDatabase(file: File): Promise<void> {
  if (!SQL) throw new Error('sql.js 未加载');

  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);

  // 验证是否为有效 SQLite 数据库
  let newDb: Database | null = null;
  try {
    newDb = new SQL.Database(data);
    // 验证关键表存在
    newDb.exec('SELECT 1 FROM categories');
  } catch {
    try { newDb?.close(); } catch { /* ignore */ }
    throw new Error('无效的数据库文件：缺少必要的表结构');
  }

  // 替换当前数据库（newDb 已通过验证，必非 null）
  if (db) db.close();
  db = newDb!;
  db.run('PRAGMA foreign_keys = ON');

  // 持久化
  dirty = true;
  await saveSnapshot();
}

// ── 自动备份 ──────────────────────────────────────────────────────

const BACKUP_PREFIX = 'jewelry-backup-';
const BACKUP_LIST_KEY = 'jewelry_backup_list';

/** 每天自动备份一次，清理 30 天前的旧备份 */
export async function autoBackup(): Promise<void> {
  const lastBackup = localStorage.getItem('jewelry_last_backup_date');
  const today = new Date().toISOString().slice(0, 10);

  if (lastBackup === today) return;

  try {
    const database = getDBSync();
    const data = database.export();
    const filename = `${BACKUP_PREFIX}${today}.db`;

    const root = await navigator.storage.getDirectory();
    let backupsDir: FileSystemDirectoryHandle;
    try {
      backupsDir = await root.getDirectoryHandle('backups', { create: true });
    } catch {
      backupsDir = await root.getDirectoryHandle('backups', { create: true });
    }

    const handle = await backupsDir.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();

    localStorage.setItem('jewelry_last_backup_date', today);

    // 记录备份文件
    const list = JSON.parse(localStorage.getItem(BACKUP_LIST_KEY) ?? '[]') as string[];
    list.push(filename);
    localStorage.setItem(BACKUP_LIST_KEY, JSON.stringify(list));

    // 清理 30 天前的旧备份
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const remaining: string[] = [];

    for (const name of list) {
      const dateStr = name.slice(BACKUP_PREFIX.length, -3);
      if (dateStr < cutoffStr) {
        await backupsDir.removeEntry(name).catch(() => {});
      } else {
        remaining.push(name);
      }
    }
    localStorage.setItem(BACKUP_LIST_KEY, JSON.stringify(remaining));
  } catch (err) {
    console.warn('自动备份失败:', err);
  }
}

/** 获取所有备份文件列表（按日期倒序） */
export function listBackups(): string[] {
  const list = JSON.parse(localStorage.getItem(BACKUP_LIST_KEY) ?? '[]') as string[];
  return list.filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith('.db')).sort().reverse();
}

/** 下载指定日期的备份文件 */
export async function downloadBackup(filename: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const backupsDir = await root.getDirectoryHandle('backups');
  const handle = await backupsDir.getFileHandle(filename);
  const file = await handle.getFile();
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 尝试原生分享
  const handled = await nativeSaveAndShare(bytes, filename);
  if (handled) return;

  // Web 降级：转 base64 存 localStorage，供 export.html 下载
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  localStorage.setItem('jewelry_export_data', btoa(binary));
  localStorage.setItem('jewelry_export_filename', filename);
  window.open(new URL(import.meta.env.BASE_URL + 'export.html', window.location.href).href, '_blank');
}
