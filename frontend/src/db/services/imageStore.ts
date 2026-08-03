/** imageStore — OPFS 图片文件存储
 *
 * 统一使用 OPFS（Origin Private File System）存储上传的图片，
 * 命名为 {分类名}_{编号}.{扩展名}，如：发圈_1.jpg、耳环_3.png
 *
 * - Web/PWA 和 Capacitor 原生环境均使用 OPFS（Android WebView / iOS WKWebView 均支持）
 * - blob URL 缓存在模块级 Map 中，避免重复读取
 * - 编号采用「当前最大编号 + 1」策略，删除产生的缺口不会导致冲突
 */

const IMAGES_DIR = 'images';

// ── blob URL 缓存 ─────────────────────────────────────────────────

const blobUrlCache = new Map<string, string>();

// ── 初始化 ────────────────────────────────────────────────────────

/** 确保 OPFS /images/ 目录存在（应用启动时调用一次） */
export async function initImageStore(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.getDirectoryHandle(IMAGES_DIR, { create: true });
  } catch (err) {
    console.warn('initImageStore failed:', err);
  }
}

// ── 判断 ──────────────────────────────────────────────────────────

/** 判断 src 是否为 base64 data URL（用于区分新旧格式） */
export function isBase64(src: string): boolean {
  return src.startsWith('data:');
}

/**
 * 从 image_path 提取用于界面展示的名称
 * - 文件名（如 发圈_1.jpg）→ 去掉扩展名显示 "发圈_1"
 * - base64 数据 → 返回 null（旧的未命名图片）
 * - 空值 → 返回 null
 */
export function getDisplayName(imagePath: string | null): string | null {
  if (!imagePath) return null;
  if (isBase64(imagePath)) return null;
  // 去掉扩展名：发圈_1.jpg → 发圈_1
  const dotIdx = imagePath.lastIndexOf('.');
  return dotIdx > 0 ? imagePath.slice(0, dotIdx) : imagePath;
}

// ── 辅助 ──────────────────────────────────────────────────────────

/** MIME 类型 → 文件扩展名 */
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
  };
  return map[mime] ?? 'jpg';
}

// ── 冲突检测 ──────────────────────────────────────────────────────

/**
 * 检查指定编号序列是否与 OPFS /images/ 中已有文件冲突
 * @returns 冲突的编号数组（为空表示全部可用）
 */
export async function checkSequenceConflicts(
  categoryName: string,
  sequences: number[],
): Promise<number[]> {
  const conflicts: number[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    let imagesDir: FileSystemDirectoryHandle;
    try {
      imagesDir = await root.getDirectoryHandle(IMAGES_DIR);
    } catch {
      return []; // 目录不存在，不可能冲突
    }

    const prefix = `${categoryName}_`;
    const seqSet = new Set(sequences);

    for await (const [name] of (imagesDir as unknown as AsyncIterable<[string, unknown]>)) {
      if (typeof name === 'string' && name.startsWith(prefix)) {
        const rest = name.slice(prefix.length);
        const numStr = rest.split('.')[0];
        const n = parseInt(numStr, 10);
        if (seqSet.has(n)) conflicts.push(n);
      }
    }
  } catch (err) {
    console.warn('checkSequenceConflicts failed:', err);
  }
  return conflicts;
}

// ── 编号 ──────────────────────────────────────────────────────────

/**
 * 获取下一组编号：[maxN + 1, maxN + 2, ..., maxN + count]
 *
 * 通过遍历 OPFS /images/ 目录下所有 {categoryName}_* 文件，
 * 解析其中的数字部分，找出最大编号后递增。
 * 如果目录不存在或遍历失败，从 1 开始。
 */
export async function getCategoryNextSequence(
  categoryName: string,
  count: number,
): Promise<number[]> {
  let maxN = 0;

  try {
    const root = await navigator.storage.getDirectory();
    let imagesDir: FileSystemDirectoryHandle;
    try {
      imagesDir = await root.getDirectoryHandle(IMAGES_DIR);
    } catch {
      // 目录尚不存在，从 1 开始
      return sequence(1, count);
    }

    const prefix = `${categoryName}_`;
    // FileSystemDirectoryHandle.entries() 返回 AsyncIterable<[string, FileSystemHandle]>
    for await (const [name] of (imagesDir as unknown as AsyncIterable<[string, unknown]>)) {
      if (typeof name === 'string' && name.startsWith(prefix)) {
        const rest = name.slice(prefix.length);
        const numStr = rest.split('.')[0];
        const n = parseInt(numStr, 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    }
  } catch (err) {
    console.warn('getCategoryNextSequence: OPFS iteration failed, starting from 1:', err);
  }

  return sequence(maxN + 1, count);
}

/** 生成 [start, start+1, ..., start+count-1] */
function sequence(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i);
}

// ── 写入 ──────────────────────────────────────────────────────────

/**
 * 批量写入图片文件到 OPFS /images/ 目录
 * @returns 文件名数组（如 ['发圈_1.jpg', '发圈_2.png']）
 */
export async function saveImageBatch(
  categoryName: string,
  files: File[],
  sequences: number[],
): Promise<string[]> {
  const root = await navigator.storage.getDirectory();
  const imagesDir = await root.getDirectoryHandle(IMAGES_DIR, { create: true });
  const filenames: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const ext = extFromMime(files[i].type);
    const filename = `${categoryName}_${sequences[i]}.${ext}`;
    const handle = await imagesDir.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(await files[i].arrayBuffer());
    await writable.close();
    filenames.push(filename);
  }

  return filenames;
}

// ── 读取 ──────────────────────────────────────────────────────────

/**
 * 从 OPFS 读取图片文件，返回 blob: URL（带内存缓存）
 *
 * @returns blob URL，文件不存在时返回 null
 */
export async function getImageBlobUrl(filename: string): Promise<string | null> {
  if (blobUrlCache.has(filename)) return blobUrlCache.get(filename)!;

  try {
    const root = await navigator.storage.getDirectory();
    const imagesDir = await root.getDirectoryHandle(IMAGES_DIR);
    const handle = await imagesDir.getFileHandle(filename);
    const file = await handle.getFile();
    const blobUrl = URL.createObjectURL(file);
    blobUrlCache.set(filename, blobUrl);
    return blobUrl;
  } catch {
    return null;
  }
}

// ── 删除 ──────────────────────────────────────────────────────────

/**
 * 删除 OPFS 中的图片文件并撤销其缓存的 blob URL
 */
export async function deleteImage(filename: string): Promise<void> {
  // 先清缓存
  const cached = blobUrlCache.get(filename);
  if (cached) {
    URL.revokeObjectURL(cached);
    blobUrlCache.delete(filename);
  }

  try {
    const root = await navigator.storage.getDirectory();
    const imagesDir = await root.getDirectoryHandle(IMAGES_DIR);
    await imagesDir.removeEntry(filename);
  } catch (err) {
    console.warn('deleteImage: failed to remove', filename, err);
  }
}
