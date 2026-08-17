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
import { initImageStore, forEachImage, countImages, listImageNames, getImageBlobUrl } from './services/imageStore';
import { createZipWriter, getTempZipFile, removeTempZip, type ZipStreamWriter } from './services/zipStream';
import { chunkedNativeShare } from '../capacitor/chunkWriter';
import { cleanupExternalBackups, createNativeZipWriter, isNativeBackupAvailable } from '../capacitor/nativeBackup';

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
    console.log('[initDB] 步骤 1/5: 开始加载 sql.js WASM...');
    const timeoutId = setTimeout(() => console.error('[initDB] ⚠️ initSqlJs 已等待 5 秒！'), 5000);
    try {
      // 手动 fetch WASM 文件，绕过 sql.js 内部加载
      const wasmRes = await fetch('/sql-wasm-browser.wasm');
      if (!wasmRes.ok) throw new Error(`WASM fetch failed: ${wasmRes.status}`);
      const wasmBinary = new Uint8Array(await wasmRes.arrayBuffer());
      SQL = await initSqlJs({ wasmBinary } as any);
      clearTimeout(timeoutId);
      console.log('[initDB] 步骤 1/5: sql.js WASM 加载完成 ✓');
    } catch (err) {
      initPromise = null; // 允许重试
      console.error('[initDB] 步骤 1/5: sql.js WASM 加载失败 ✗', err);
      throw new Error(`sql.js WASM 加载失败（路径: ${import.meta.env.BASE_URL}sql-wasm-browser.wasm）: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 尝试恢复已有数据库
    console.log('[initDB] 步骤 2/5: 尝试从 OPFS 恢复数据库...');
    let saved = await loadFromOPFS();
    if (!saved) {
      console.log('[initDB] 步骤 2/5: OPFS 无数据，尝试 IndexedDB...');
      saved = await loadFromIndexedDB();
    }
    console.log('[initDB] 步骤 2/5: 数据库恢复完成 (saved=%s)', saved ? `${saved.length} bytes` : 'null');

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
  const filename = `jewelry-backup-${getLocalDateString()}.db`;

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

/**
 * 导出数据库 + 全部图片为 zip 包（流式，不爆内存）。
 *
 * Android 原生：zip 直接写入 内部存储/Download/JewelryTracker/；
 * 其余平台：打包到临时文件后调起系统分享 / Web 下载。
 *
 * @param onProgress 进度回调 (current, total)，用于 UI 展示进度
 * @returns 'saved' 已直写目标目录；'shared' 已通过分享面板处理；'download' Web 下载已触发
 */
export async function exportDatabaseWithImages(
  onProgress?: (current: number, total: number) => void,
): Promise<'saved' | 'shared' | 'download'> {
  const database = getDBSync();
  const dbData = database.export();
  const dbBytes = new Uint8Array(dbData);
  const dbFilename = `jewelry-backup-${getLocalDateString()}.db`;
  const zipFilename = `jewelry-backup-${getLocalDateString()}.zip`;

  // 统计总数（DB 1 个 + 图片 N 张）
  const imageCount = await countImages();
  const total = 1 + imageCount;

  // Android 原生：zip 直接写入 内部存储/Download/JewelryTracker/
  if (isNativeBackupAvailable()) {
    const writer = await createNativeZipWriter(zipFilename);
    try {
      await writeFullBackupZip(writer, dbFilename, dbBytes, onProgress, total);
    } catch (err) {
      await writer.abort();
      throw err;
    }
    return 'saved';
  }

  // 其余平台：流式写入临时 zip，再分享 / 下载
  const writer = await createZipWriter(zipFilename);
  try {
    await writeFullBackupZip(writer, dbFilename, dbBytes, onProgress, total);
  } catch (err) {
    await writer.abort();
    await removeTempZip(zipFilename);
    throw err;
  }

  // ── 分享：优先用原生分片写入器（JS 内存只留 1MB）───────────────

  const zipFile = await getTempZipFile(zipFilename);

  // 方案 A：原生分片写入 + 系统分享面板（大文件安全，不爆内存）
  const nativeHandled = await chunkedNativeShare(
    zipFile,
    zipFilename,
    'application/zip',
    '首饰管家 完整备份',
  );
  if (nativeHandled) {
    await removeTempZip(zipFilename);
    return 'shared';
  }

  // 方案 B：Capacitor 传统分享（需要加载完整文件到内存，适用于中等规模）
  if ((window as any).Capacitor?.isNative) {
    const buffer = await zipFile.arrayBuffer();
    const zipBytes = new Uint8Array(buffer);
    const handled = await nativeSaveAndShare(zipBytes, zipFilename);
    await removeTempZip(zipFilename);
    if (handled) return 'shared';
  }

  // 方案 C：Web Blob 下载
  const blob = new Blob([await zipFile.arrayBuffer()], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  await removeTempZip(zipFilename);
  return 'download';
}

/** 向 zip 写入器写入数据库 + 全部图片（手动导出打包复用） */
async function writeFullBackupZip(
  writer: ZipStreamWriter,
  dbFilename: string,
  dbBytes: Uint8Array,
  onProgress?: (current: number, total: number) => void,
  total = 1,
): Promise<void> {
  // 写入数据库文件
  await writer.addFile(dbFilename, dbBytes);
  onProgress?.(1, total);

  // 逐张写入图片（每次只读一张，写入后释放）
  let imgIndex = 1;
  await forEachImage(async (name, data) => {
    await writer.addFile('images/' + name, data);
    imgIndex++;
    onProgress?.(imgIndex, total);
  });

  // 写中央目录 + 关闭
  await writer.finalize();
}

/** 导入数据库文件，替换当前数据库。支持 .db（SQLite）和 .zip（完整备份）。 */
export async function importDatabase(file: File): Promise<void> {
  if (!SQL) throw new Error('sql.js 未加载');

  const buffer = await file.arrayBuffer();

  // ZIP 完整备份：提取 .db + 恢复图片
  if (file.name.endsWith('.zip')) {
    await importFromZip(new Uint8Array(buffer));
    return;
  }

  await importRawDB(new Uint8Array(buffer));
}

/** 导入原始 SQLite 数据 */
async function importRawDB(data: Uint8Array): Promise<void> {
  if (!SQL) throw new Error('sql.js 未加载');

  let newDb: Database | null = null;
  try {
    newDb = new SQL.Database(data);
    newDb.exec('SELECT 1 FROM categories');
  } catch {
    try { newDb?.close(); } catch { /* ignore */ }
    throw new Error('无效的数据库文件：缺少必要的表结构');
  }

  if (db) db.close();
  db = newDb!;
  db.run('PRAGMA foreign_keys = ON');

  dirty = true;
  await saveSnapshot();
}

/** 从 ZIP 完整备份导入：提取数据库 + 恢复图片 */
async function importFromZip(zipData: Uint8Array): Promise<void> {
  if (!SQL) throw new Error('sql.js 未加载');

  // 动态导入 JSZip（减小首屏包体积）
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(zipData);

  // 查找 .db 文件
  const dbFileName = Object.keys(zip.files).find((n) => n.endsWith('.db'));
  if (!dbFileName) throw new Error('ZIP 中未找到数据库文件');

  const dbData = await zip.files[dbFileName].async('uint8array');

  // 验证并替换数据库
  let newDb: Database | null = null;
  try {
    newDb = new SQL.Database(dbData);
    newDb.exec('SELECT 1 FROM categories');
  } catch {
    try { newDb?.close(); } catch { /* ignore */ }
    throw new Error('ZIP 中的数据库无效：缺少必要的表结构');
  }

  if (db) db.close();
  db = newDb!;
  db.run('PRAGMA foreign_keys = ON');

  // 恢复图片文件到 OPFS
  const imageEntries = Object.keys(zip.files).filter(
    (n) => n.startsWith('images/') && n !== 'images/' && !zip.files[n].dir,
  );
  if (imageEntries.length > 0) {
    const root = await navigator.storage.getDirectory();
    const imagesDir = await root.getDirectoryHandle('images', { create: true });

    for (const imagePath of imageEntries) {
      const filename = imagePath.replace(/^images\//, '');
      if (!filename) continue;
      try {
        const imgData = await zip.files[imagePath].async('uint8array');
        const handle = await imagesDir.getFileHandle(filename, { create: true });
        const writable = await handle.createWritable();
        await writable.write(imgData);
        await writable.close();
      } catch (err) {
        console.warn(`导入图片 ${filename} 失败:`, err);
      }
    }
  }

  dirty = true;
  await saveSnapshot();
}

// ── 数据浏览（DataBrowser 页面用）────────────────────────────────

/** 获取所有用户表名（排除 sqlite_ 内部表） */
export function getTableNames(): string[] {
  const database = getDBSync();
  const result = database.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  if (!result.length) return [];
  return result[0].values.map((row) => row[0] as string);
}

/** 获取表的列信息 */
export function getTableColumns(
  tableName: string,
): { cid: number; name: string; type: string; notnull: number; pk: number }[] {
  const database = getDBSync();
  const result = database.exec(`PRAGMA table_info('${tableName}')`);
  if (!result.length) return [];
  return result[0].values.map((row) => ({
    cid: row[0] as number,
    name: row[1] as string,
    type: row[2] as string,
    notnull: row[3] as number,
    pk: row[4] as number,
  }));
}

/** 查询表数据（分页） */
export function queryTableData(
  tableName: string,
  offset: number,
  limit: number,
): Record<string, unknown>[] {
  const database = getDBSync();
  const colsResult = database.exec(`PRAGMA table_info('${tableName}')`);
  if (!colsResult.length) return [];
  const columns = colsResult[0].values.map((row) => row[1] as string);

  // items 表先按分类 sort_order 倒序（盒子→戒指→…→发卡），分类内再按文件名倒序：
  // 把「分类_编号」拆成 前缀 + 编号，前缀倒序 + 编号倒序（多位数不串位），base64 / NULL 排最后。
  // categories 表按 sort_order 倒序；其余表维持 rowid 倒序（最新写入在前）
  const orderBy =
    tableName === 'items'
      ? `(
          SELECT i.*,
            c.sort_order AS __catOrder,
            CASE WHEN i.image_path IS NULL OR i.image_path LIKE 'data:%' THEN 1 ELSE 0 END AS __unp,
            CASE WHEN instr(i.image_path, '.') > 0
                 THEN substr(i.image_path, 1, instr(i.image_path, '.') - 1)
                 ELSE i.image_path END AS __noext
          FROM items i
          JOIN categories c ON c.id = i.category_id
        )
        ORDER BY __catOrder DESC,
          __unp,
          trim(__noext, '0123456789') DESC,
          CAST(substr(__noext, length(trim(__noext, '0123456789')) + 1) AS INTEGER) DESC,
          id DESC`
      : tableName === 'categories'
        ? `"categories" ORDER BY sort_order DESC`
        : `"${tableName}" ORDER BY rowid DESC`;

  const stmt = database.prepare(`SELECT * FROM ${orderBy} LIMIT ? OFFSET ?`);
  stmt.bind([limit, offset] as unknown as Record<string, unknown>);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const mapped: Record<string, unknown> = {};
    for (const col of columns) {
      mapped[col] = row[col];
    }
    rows.push(mapped);
  }
  stmt.free();
  return rows;
}

/** 获取表行数 */
export function getTableRowCount(tableName: string): number {
  const database = getDBSync();
  const result = database.exec(`SELECT COUNT(*) FROM "${tableName}"`);
  if (!result.length) return 0;
  return result[0].values[0][0] as number;
}

/** 获取当前数据库的原始字节（供外部查看器使用） */
export function getDBBytes(): Uint8Array {
  const database = getDBSync();
  return new Uint8Array(database.export());
}

/** 列出所有图片文件名 */
export async function listAllImageFiles(): Promise<string[]> {
  return listImageNames();
}

/** 获取图片 blob URL（重新导出 imageStore 的函数） */
export { getImageBlobUrl };

// ── 自动备份 ──────────────────────────────────────────────────────

const BACKUP_PREFIX = 'jewelry-backup-';

/** 获取本地时区日期字符串 YYYY-MM-DD（中国时间 UTC+8） */
function getLocalDateString(date?: Date): string {
  const d = date ?? new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 每天自动备份一次（完整 zip：数据库 + 全部图片），
 * Android 直写 内部存储/Download/JewelryTracker/，保留最近 5 天。
 * Web / iOS / 旧系统（API<29）无原生桥，不做自动备份。
 */
export async function autoBackup(): Promise<void> {
  if (!isNativeBackupAvailable()) return;

  const lastBackup = localStorage.getItem('jewelry_last_backup_date');
  const today = getLocalDateString();

  if (lastBackup === today) return;

  try {
    const database = getDBSync();
    const dbBytes = new Uint8Array(database.export());
    const dbFilename = `${BACKUP_PREFIX}${today}.db`;
    const zipFilename = `${BACKUP_PREFIX}${today}.zip`;

    // zip 直接分片写入 Download/JewelryTracker/
    const writer = await createNativeZipWriter(zipFilename);

    try {
      await writer.addFile(dbFilename, dbBytes);

      await forEachImage(async (name, data) => {
        await writer.addFile('images/' + name, data);
      });

      await writer.finalize();
    } catch (err) {
      await writer.abort(); // 清理半成品
      throw err;
    }

    // 清理 5 天前的旧备份
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 5);
    cleanupExternalBackups(getLocalDateString(cutoff));

    localStorage.setItem('jewelry_last_backup_date', today);
  } catch (err) {
    console.warn('自动备份失败:', err);
  }
}
