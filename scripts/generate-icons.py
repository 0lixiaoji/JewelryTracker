"""生成 PWA 图标 — 纯 Python，无需额外依赖"""
import struct
import zlib


def make_png(size: int, path: str) -> None:
    """生成 size×size 纯色 PNG"""
    r, g, b = 0xD4, 0xA5, 0x74  # 主题色 #d4a574

    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB

    # IDAT — raw pixel data with filter byte 0 for each row
    raw = b""
    for _ in range(size):
        raw += b"\x00"  # filter: None
        raw += bytes([r, g, b]) * size

    compressed = zlib.compress(raw)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr_data)
    png += chunk(b"IDAT", compressed)
    png += chunk(b"IEND", b"")

    with open(path, "wb") as f:
        f.write(png)
    print(f"  OK {path} ({size}x{size})")


if __name__ == "__main__":
    print("Generating PWA icons...")
    make_png(192, "frontend/public/icon-192.png")
    make_png(512, "frontend/public/icon-512.png")
    print("Done!")
