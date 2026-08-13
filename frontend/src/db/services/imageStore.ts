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

    await iterateDirectory(imagesDir, async (name) => {
      if (name.startsWith(prefix)) {
        const rest = name.slice(prefix.length);
        const numStr = rest.split('.')[0];
        const n = parseInt(numStr, 10);
        if (seqSet.has(n)) conflicts.push(n);
      }
    });
  } catch (err) {
    console.warn('checkSequenceConflicts failed:', err);
  }
  return conflicts;
}

// ── 编号 ──────────────────────────────────────────────────────────

/** 从 OPFS 文件名解析编号，如 发圈_2.jpg → 2 */
export function parseSequenceFromFilename(filename: string): number {
  const dotIdx = filename.lastIndexOf('.');
  const nameWithoutExt = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const lastUnderscoreIdx = nameWithoutExt.lastIndexOf('_');
  if (lastUnderscoreIdx < 0) return 1;
  const num = parseInt(nameWithoutExt.slice(lastUnderscoreIdx + 1), 10);
  return isNaN(num) ? 1 : num;
}

/** 从 OPFS 文件名解析前缀，如 手镯_10.jpg → 手镯 */
export function parsePrefixFromFilename(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  const nameWithoutExt = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const lastUnderscoreIdx = nameWithoutExt.lastIndexOf('_');
  if (lastUnderscoreIdx < 0) return nameWithoutExt;
  return nameWithoutExt.slice(0, lastUnderscoreIdx);
}

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
    await iterateDirectory(imagesDir, async (name) => {
      if (name.startsWith(prefix)) {
        const rest = name.slice(prefix.length);
        const numStr = rest.split('.')[0];
        const n = parseInt(numStr, 10);
        if (!isNaN(n) && n > maxN) maxN = n;
      }
    });
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

// ── 移动（跨分类重命名） ───────────────────────────────────────────

/**
 * 将图片从旧文件名改名为新分类前缀的文件，供「移动分类」使用。
 * 编号取新分类下一号（max+1），与「录入」保持一致——
 * 分类清空后从 1 重新开始，编号紧凑无空洞。
 *
 * @returns 新文件名；旧文件不存在或写入失败时返回 null（调用方保留原路径）
 */
export async function moveImageFile(oldFilename: string, newPrefix: string): Promise<string | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const imagesDir = await root.getDirectoryHandle(IMAGES_DIR);

    // 读旧文件字节
    let oldFile: File;
    try {
      oldFile = await (await imagesDir.getFileHandle(oldFilename)).getFile();
    } catch {
      return null; // 旧文件不存在，无法重命名
    }

    // 沿用原扩展名（保持 png/gif 等不被 jpg 默认覆盖）
    const dotIdx = oldFilename.lastIndexOf('.');
    const ext = dotIdx > 0 ? oldFilename.slice(dotIdx + 1) : 'jpg';

    // 目标编号：取新分类下一号（max+1）
    const seq = (await getCategoryNextSequence(newPrefix, 1))[0];

    const newFilename = `${newPrefix}_${seq}.${ext}`;
    const buffer = await oldFile.arrayBuffer();

    const newHandle = await imagesDir.getFileHandle(newFilename, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(buffer);
    await writable.close();

    // 删除旧文件并清理 blob URL 缓存
    try { await imagesDir.removeEntry(oldFilename); } catch { /* 已不存在 */ }
    const cached = blobUrlCache.get(oldFilename);
    if (cached) {
      URL.revokeObjectURL(cached);
      blobUrlCache.delete(oldFilename);
    }

    return newFilename;
  } catch (err) {
    console.warn('moveImageFile failed:', err);
    return null;
  }
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

// ── 批量读取 ──────────────────────────────────────────────────────

// ── 目录遍历辅助 ──────────────────────────────────────────────────

/**
 * 遍历 OPFS 目录，尝试多种迭代方式以兼容不同 WebView。
 * 回调返回 false 可提前终止遍历。
 * @returns true 表示遍历成功，false 表示所有方法均失败
 */
async function iterateDirectory(
  dir: FileSystemDirectoryHandle,
  onEntry: (name: string, handle: FileSystemHandle) => Promise<boolean | void>,
): Promise<boolean> {
  // 方法 1：.keys() + .getFileHandle() 组合
  try {
    const keys = (dir as any).keys?.();
    if (keys) {
      for await (const name of keys) {
        if (typeof name !== 'string') continue;
        let handle: FileSystemHandle;
        try {
          handle = await dir.getFileHandle(name);
        } catch {
          try { handle = await dir.getDirectoryHandle(name); } catch { continue; }
        }
        const result = await onEntry(name, handle);
        if (result === false) return true;
      }
      return true;
    }
  } catch { /* try next */ }

  // 方法 2：.entries() 获取 [name, handle] 对
  try {
    const entries = (dir as any).entries?.();
    if (entries) {
      for await (const [name, handle] of entries) {
        if (typeof name !== 'string') continue;
        const result = await onEntry(name, handle as FileSystemHandle);
        if (result === false) return true;
      }
      return true;
    }
  } catch { /* try next */ }

  // 方法 3：直接异步迭代句柄（桌面 Chrome 兼容）
  try {
    for await (const entry of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      const name = Array.isArray(entry) ? entry[0] : undefined;
      const handle = Array.isArray(entry) ? entry[1] : undefined;
      if (typeof name !== 'string') continue;
      const result = await onEntry(name, handle as FileSystemHandle);
      if (result === false) return true;
    }
    return true;
  } catch { /* fall through */ }

  return false;
}

// ── 统计 ──────────────────────────────────────────────────────────

/**
 * 统计 OPFS /images/ 目录下的图片数量（只遍历文件名，不读取文件内容）。
 */
export async function countImages(): Promise<number> {
  try {
    const root = await navigator.storage.getDirectory();
    let imagesDir: FileSystemDirectoryHandle;
    try {
      imagesDir = await root.getDirectoryHandle(IMAGES_DIR);
    } catch {
      return 0;
    }
    let count = 0;
    await iterateDirectory(imagesDir, async (_name) => {
      count++;
    });
    return count;
  } catch {
    return 0;
  }
}

/**
 * 逐个读取 OPFS /images/ 目录下的所有图片文件（原图，不做任何压缩）。
 *
 * 与 readAllImages 不同，此函数每读一张图片就调用一次 callback，
 * 图片数据在 callback 返回后即可被 GC 回收，避免 252 张原图全部驻留内存导致 OOM。
 *
 * @param onImage 每张图片的回调，返回 false 可提前终止遍历
 */
export async function forEachImage(
  onImage: (name: string, data: Uint8Array) => Promise<boolean | void>,
): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    let imagesDir: FileSystemDirectoryHandle;
    try {
      imagesDir = await root.getDirectoryHandle(IMAGES_DIR);
    } catch {
      return;
    }

    await iterateDirectory(imagesDir, async (name, handle) => {
      if (!(handle instanceof FileSystemFileHandle)) return;
      try {
        const file = await handle.getFile();
        const buffer = await file.arrayBuffer();
        return await onImage(name, new Uint8Array(buffer));
      } catch (err) {
        console.warn(`forEachImage: 跳过 ${name} —`, err);
      }
    });
  } catch (err) {
    console.warn('forEachImage: OPFS 遍历失败 —', err);
  }
}

/**
 * 读取 OPFS /images/ 目录下的所有图片文件（原图，不做任何压缩）。
 *
 * ⚠️ 注意：此函数会将所有图片同时加载到内存中。
 * 图片数量多时（>50 张原图）可能触发移动端 OOM。
 * 大量图片导出请使用 forEachImage() 流式处理。
 *
 * @returns {name: 文件名, data: 原始二进制} 数组，目录不存在时返回空数组
 */
export async function readAllImages(): Promise<{ name: string; data: Uint8Array }[]> {
  const result: { name: string; data: Uint8Array }[] = [];
  await forEachImage(async (name, data) => {
    result.push({ name, data });
  });
  return result;
}

// ── 列出文件名 ──────────────────────────────────────────────────────

/**
 * 列出 OPFS /images/ 目录下所有图片文件名（不读取文件内容）。
 * 按名称排序，可用于图片浏览器。
 */
export async function listImageNames(): Promise<string[]> {
  const names: string[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    let imagesDir: FileSystemDirectoryHandle;
    try {
      imagesDir = await root.getDirectoryHandle(IMAGES_DIR);
    } catch {
      return [];
    }

    const ok = await iterateDirectory(imagesDir, async (name) => {
      names.push(name);
    });
    if (!ok) {
      console.warn('listImageNames: 所有目录遍历方法均失败');
    }
    names.sort();
  } catch (err) {
    console.warn('listImageNames failed:', err);
  }
  return names;
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
