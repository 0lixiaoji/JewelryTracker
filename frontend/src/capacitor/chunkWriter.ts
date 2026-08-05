/** chunkWriter — 原生分片文件写入 + 分享
 *
 * 场景：导出大 zip 时，JS 以 ~1MB 分片从 OPFS 读取，
 * 逐片交给原生层追加写入 Cache 目录，完成后原生层直接弹出分享面板。
 *
 * JS 内存中始终只保留当前分片（~1MB），彻底避免大文件 OOM。
 *
 * Web 模式下（无原生接口），返回 false，由调用方走 Blob 下载降级。
 */

// ── 原生接口类型 ────────────────────────────────────────────────────

interface NativeChunkWriterAPI {
  create(filename: string): void;
  write(filename: string, base64Chunk: string): void;
  finishAndShare(filename: string, mimeType: string, title: string): void;
}

declare global {
  interface Window {
    NativeChunkWriter?: NativeChunkWriterAPI;
  }
}

// ── 公开方法 ────────────────────────────────────────────────────────

/** 检查原生分片写入器是否可用 */
export function isChunkWriterAvailable(): boolean {
  return typeof window.NativeChunkWriter !== 'undefined';
}

/**
 * 向原生层追加写入一个分片（base64 编码的二进制数据）。
 *
 * 首次调用前需通过 create() 创建文件句柄。
 */
function nativeWrite(filename: string, base64Chunk: string): void {
  window.NativeChunkWriter!.write(filename, base64Chunk);
}

/** 在原生层创建文件并打开写入流 */
function nativeCreate(filename: string): void {
  window.NativeChunkWriter!.create(filename);
}

/** 关闭原生文件流，弹出系统分享面板 */
function nativeFinishAndShare(filename: string, mimeType: string, title: string): void {
  window.NativeChunkWriter!.finishAndShare(filename, mimeType, title);
}

// ── 端到端导出 ──────────────────────────────────────────────────────

/**
 * 将 OPFS 中的大文件以分片方式复制到原生 Cache 目录，完成后弹出系统分享。
 *
 * 流程：
 * 1. nativeCreate() 打开原生文件
 * 2. 对 OPFS 文件按 1MB 分片 slice → arrayBuffer → base64 → nativeWrite()
 * 3. nativeFinishAndShare() 关闭文件并弹出分享面板
 *
 * @param opfsFile  OPFS 中的 File 对象（引用，不消耗内存）
 * @param filename  输出文件名（如 jewelry-fullbackup-2026-08-05.zip）
 * @param mimeType  MIME 类型（如 application/zip）
 * @param title     分享对话框标题
 * @returns true 表示已通过原生分享处理
 */
export async function chunkedNativeShare(
  opfsFile: File,
  filename: string,
  mimeType: string,
  title: string,
): Promise<boolean> {
  if (!isChunkWriterAvailable()) return false;

  const CHUNK_SIZE = 1024 * 1024; // 1MB per chunk
  const totalSize = opfsFile.size;
  const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);

  try {
    // 创建原生文件
    nativeCreate(filename);

    // 逐片读取 + 写入
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalSize);
      const blob = opfsFile.slice(start, end);
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // 转为 base64（仅当前分片在 JS 内存中）
      let binary = '';
      for (let j = 0; j < bytes.length; j++) {
        binary += String.fromCharCode(bytes[j]);
      }
      const base64 = btoa(binary);

      nativeWrite(filename, base64);
    }

    // 关闭并弹出分享面板
    nativeFinishAndShare(filename, mimeType, title);
    return true;
  } catch (err) {
    console.warn('chunkedNativeShare 失败:', err);
    return false;
  }
}
