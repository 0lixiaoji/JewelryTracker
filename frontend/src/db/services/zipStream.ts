/** zipStream — 流式 ZIP 写入 OPFS
 *
 * 不做压缩（store 模式），图片本身已是 JPEG/PNG 压缩格式。
 * 每次只在内存中保留当前处理的单个文件，避免 OOM。
 *
 * ZIP 格式参考: PKWARE APPNOTE 4.5
 */

// ── CRC32 查表 ─────────────────────────────────────────────────────

const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── 时间编码为 DOS 格式 ────────────────────────────────────────────

function dosDateTime(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const min = date.getMinutes();
  const sec = date.getSeconds();
  const time = (hour << 11) | (min << 5) | (sec >> 1);
  const d = ((year - 1980) << 9) | (month << 5) | day;
  return (time << 16) | d;
}

// ── 辅助写入函数 ────────────────────────────────────────────────────

function putU16(buf: Uint8Array, offset: number, v: number) {
  buf[offset] = v & 0xff;
  buf[offset + 1] = (v >> 8) & 0xff;
}

function putU32(buf: Uint8Array, offset: number, v: number) {
  buf[offset] = v & 0xff;
  buf[offset + 1] = (v >> 8) & 0xff;
  buf[offset + 2] = (v >> 16) & 0xff;
  buf[offset + 3] = (v >> 24) & 0xff;
}

function encodeStr(s: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(s);
}

// ── 文件条目元数据（在流式写入过程中收集，用于最终写中央目录）──────

interface FileEntry {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number; // 相对于 zip 文件起始的偏移
}

// ── zip 写入目标抽象 ────────────────────────────────────────────────

/**
 * 底层写入目标：写入字节 / 收尾 / 出错清理。
 * OPFS 文件流与原生直写桥各自实现此接口。
 */
export interface ZipSink {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

// ── 流式 ZIP 写入器 ─────────────────────────────────────────────────

export class ZipStreamWriter {
  private sink: ZipSink | null = null;
  private entries: FileEntry[] = [];
  private currentOffset = 0;
  private dosTime: number;

  constructor(private openSink: () => Promise<ZipSink>) {
    this.dosTime = dosDateTime(new Date());
  }

  /** 打开写入目标 */
  async open(): Promise<void> {
    this.sink = await this.openSink();
  }

  /**
   * 追加一个文件到 zip 归档（store 模式，无压缩）。
   * 数据立即写入目标，不在内存中缓存。
   */
  async addFile(name: string, data: Uint8Array): Promise<void> {
    if (!this.sink) throw new Error('ZipStreamWriter 未打开');

    const nameBytes = encodeStr(name);
    const checksum = crc32(data);
    const header = new Uint8Array(30 + nameBytes.length);

    let pos = 0;
    putU32(header, pos, 0x04034b50); pos += 4;  // local file header signature
    putU16(header, pos, 20); pos += 2;           // version needed
    putU16(header, pos, 0); pos += 2;            // flags
    putU16(header, pos, 0); pos += 2;            // compression: store
    putU32(header, pos, this.dosTime); pos += 4; // dos date/time
    putU32(header, pos, checksum); pos += 4;      // crc32
    putU32(header, pos, data.length); pos += 4;   // compressed size
    putU32(header, pos, data.length); pos += 4;   // uncompressed size
    putU16(header, pos, nameBytes.length); pos += 2; // filename length
    putU16(header, pos, 0); pos += 2;            // extra field length
    header.set(nameBytes, pos);

    // 记录元数据
    this.entries.push({
      nameBytes,
      crc: checksum,
      size: data.length,
      offset: this.currentOffset,
    });

    // 写入 header + data
    await this.sink.write(header);
    await this.sink.write(data);
    this.currentOffset += header.length + data.length;
  }

  /**
   * 写入中央目录 + EOCD，关闭写入目标。
   * 调用后不可再 addFile。
   */
  async finalize(): Promise<void> {
    if (!this.sink) throw new Error('ZipStreamWriter 未打开');

    const cdStart = this.currentOffset;
    let cdSize = 0;

    // 写入中央目录（同时累计大小）
    for (const entry of this.entries) {
      const buf = new Uint8Array(46 + entry.nameBytes.length);
      let pos = 0;
      putU32(buf, pos, 0x02014b50); pos += 4;  // central directory signature
      putU16(buf, pos, 20); pos += 2;           // version made by
      putU16(buf, pos, 20); pos += 2;           // version needed
      putU16(buf, pos, 0); pos += 2;            // flags
      putU16(buf, pos, 0); pos += 2;            // compression: store
      putU32(buf, pos, this.dosTime); pos += 4; // dos date/time
      putU32(buf, pos, entry.crc); pos += 4;    // crc32
      putU32(buf, pos, entry.size); pos += 4;   // compressed size
      putU32(buf, pos, entry.size); pos += 4;   // uncompressed size
      putU16(buf, pos, entry.nameBytes.length); pos += 2; // filename length
      putU16(buf, pos, 0); pos += 2;            // extra field length
      putU16(buf, pos, 0); pos += 2;            // file comment length
      putU16(buf, pos, 0); pos += 2;            // disk number start
      putU16(buf, pos, 0); pos += 2;            // internal file attributes
      putU32(buf, pos, 0); pos += 4;            // external file attributes
      putU32(buf, pos, entry.offset); pos += 4; // relative offset of local header
      buf.set(entry.nameBytes, pos);

      await this.sink.write(buf);
      cdSize += buf.length;
    }

    const eocd = new Uint8Array(22);
    let pos = 0;
    putU32(eocd, pos, 0x06054b50); pos += 4;    // EOCD signature
    putU16(eocd, pos, 0); pos += 2;              // disk number
    putU16(eocd, pos, 0); pos += 2;              // disk with CD
    putU16(eocd, pos, this.entries.length); pos += 2; // entries on disk
    putU16(eocd, pos, this.entries.length); pos += 2; // total entries
    putU32(eocd, pos, cdSize); pos += 4;         // CD size
    putU32(eocd, pos, cdStart); pos += 4;        // CD offset
    putU16(eocd, pos, 0);                        // comment length

    await this.sink.write(eocd);
    await this.sink.close();
    this.sink = null;
  }

  /** 出错时清理 */
  async abort(): Promise<void> {
    if (this.sink) {
      try { await this.sink.abort(); } catch { /* ignore */ }
      this.sink = null;
    }
  }
}

// ── 便捷函数 ────────────────────────────────────────────────────────

/**
 * 在指定目录下创建流式 ZIP 文件。
 * 调用方通过 writer.addFile() 逐个写入文件，最后调用 writer.finalize()。
 *
 * @param zipFilename 输出文件名（如 `jewelry-fullbackup-2026-08-05.zip`）
 * @param parentDir 目录名（默认 temp）
 * @returns ZipStreamWriter 实例
 */
export async function createZipWriter(
  zipFilename: string,
  parentDir: string = 'temp',
): Promise<ZipStreamWriter> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(parentDir, { create: true });
  const handle = await dir.getFileHandle(zipFilename, { create: true });
  const writer = new ZipStreamWriter(async () => {
    const writable = await handle.createWritable();
    return {
      async write(bytes: Uint8Array) {
        await writable.write(bytes);
      },
      async close() {
        await writable.close();
      },
      async abort() {
        await writable.close();
      },
    };
  });
  await writer.open();
  return writer;
}

/**
 * 获取 OPFS /temp/ 下的 zip 文件的 File 对象引用（不加载内容到内存）。
 */
export async function getTempZipFile(filename: string): Promise<File> {
  const root = await navigator.storage.getDirectory();
  const tempDir = await root.getDirectoryHandle('temp');
  const handle = await tempDir.getFileHandle(filename);
  return handle.getFile();
}

/**
 * 删除 OPFS /temp/ 下的 zip 文件
 */
export async function removeTempZip(filename: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const tempDir = await root.getDirectoryHandle('temp');
    await tempDir.removeEntry(filename);
  } catch { /* ignore */ }
}
