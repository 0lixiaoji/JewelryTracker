/** nativeBackup — 每日备份分片直写 内部存储/Download/JewelryTracker/
 *
 * 通过原生 NativeBackupExporter 桥（BackupExporter.java + MediaStore Downloads）
 * 写入公共 Download 目录（无需存储权限），文件管理器可见。
 * zip 分片 base64 直写原生层，JS 内存只保留当前缓冲块，避免 OOM。
 *
 * Web / iOS / 旧系统（API<29）无此桥，isNativeBackupAvailable() 返回 false。
 */

import { getPlatform } from './index';
import { ZipStreamWriter, type ZipSink } from '../db/services/zipStream';

// ── 原生接口类型 ────────────────────────────────────────────────────

interface NativeBackupExporterAPI {
  isAvailable(): boolean;
  create(filename: string): boolean;
  write(filename: string, base64Chunk: string): void;
  finish(filename: string): boolean;
  delete(filename: string): boolean;
  list(): string[];
  cleanup(cutoffDateStr: string): void;
}

declare global {
  interface Window {
    NativeBackupExporter?: NativeBackupExporterAPI;
  }
}

// ── 可用性判断 ──────────────────────────────────────────────────────

/** 仅在 Android 原生环境且系统支持（API 29+）时可用 */
export function isNativeBackupAvailable(): boolean {
  try {
    return (
      getPlatform() === 'android' &&
      typeof window.NativeBackupExporter !== 'undefined' &&
      window.NativeBackupExporter.isAvailable()
    );
  } catch {
    return false;
  }
}

// ── base64 工具（同 chunkWriter 模式）───────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── 原生写入目标（实现 zipStream 的 ZipSink 接口）────────────────────

const FLUSH_THRESHOLD = 512 * 1024; // 攒够 512KB 刷一次
const MAX_CHUNK = 1024 * 1024;      // 单分片 ≤1MB

export class NativeSink implements ZipSink {
  private buffers: Uint8Array[] = [];
  private buffered = 0;

  constructor(private filename: string) {}

  async write(bytes: Uint8Array): Promise<void> {
    // 大块（如单张图片）直接拆分写，避免整块合并拷贝翻倍内存
    if (bytes.length >= FLUSH_THRESHOLD) {
      await this.flush();
      this.sendDirect(bytes);
      return;
    }
    this.buffers.push(bytes);
    this.buffered += bytes.length;
    if (this.buffered >= FLUSH_THRESHOLD) {
      await this.flush();
    }
  }

  /** 合并缓冲并分片写入原生层 */
  private async flush(): Promise<void> {
    if (this.buffered === 0) return;
    const merged = new Uint8Array(this.buffered);
    let off = 0;
    for (const b of this.buffers) {
      merged.set(b, off);
      off += b.length;
    }
    this.buffers = [];
    this.buffered = 0;
    this.sendDirect(merged);
  }

  /** 将一段字节拆成 ≤1MB 子分片逐个 base64 写入原生层 */
  private sendDirect(bytes: Uint8Array): void {
    const api = window.NativeBackupExporter!;
    for (let start = 0; start < bytes.length; start += MAX_CHUNK) {
      const chunk = bytes.subarray(start, Math.min(start + MAX_CHUNK, bytes.length));
      api.write(this.filename, bytesToBase64(chunk));
    }
  }

  async close(): Promise<void> {
    await this.flush();
    if (!window.NativeBackupExporter!.finish(this.filename)) {
      throw new Error('备份文件完成失败');
    }
  }

  async abort(): Promise<void> {
    try { window.NativeBackupExporter!.finish(this.filename); } catch { /* ignore */ }
    try { window.NativeBackupExporter!.delete(this.filename); } catch { /* ignore */ }
  }
}

/** 创建直写 内部存储/Download/JewelryTracker/ 的 zip 写入器 */
export async function createNativeZipWriter(filename: string): Promise<ZipStreamWriter> {
  const writer = new ZipStreamWriter(async () => {
    if (!window.NativeBackupExporter!.create(filename)) {
      throw new Error('备份文件创建失败');
    }
    return new NativeSink(filename);
  });
  await writer.open();
  return writer;
}

/** 清理日期早于 cutoffDateStr（YYYY-MM-DD）的旧备份 */
export function cleanupExternalBackups(cutoffDateStr: string): void {
  try {
    window.NativeBackupExporter?.cleanup(cutoffDateStr);
  } catch { /* ignore */ }
}
