"""
将手镯分类图按网格切分成单个首饰图片。
均匀网格 4列×9行, 每格 540×630, 顶部偏移 4px。
非对称 margin 确保手镯完整不被裁切。
通过颜色饱和度和像素方差自动识别空白占位格并跳过。
输出: database/seed-images/items/bracelets/手镯_01.jpg ~ 手镯_34.jpg
"""

from PIL import Image
import numpy as np
import os
import sys

# --- 网格参数 ---
COLS = 4
ROWS = 9
CELL_W = 540
CELL_H = 630
Y_OFF = 4

# 非对称 margin
MARGIN_L = 180
MARGIN_R = 75
MARGIN_T = 20
MARGIN_B = 100

# 空白格检测阈值
BLANK_SATURATION = 25   # RGB 三通道极差 < 此值判定为灰色空白
BLANK_STD = 15          # 像素标准差 < 此值判定为均匀空白


def build_row_bounds(h):
    """构建行边界列表, 修正已知的偏移"""
    bounds = [0]
    for r in range(1, ROWS):
        y = Y_OFF + r * CELL_H
        if r == 4:
            y = 2583   # R3/R4 实际边界
        if r == 5:
            y = 3154   # R4/R5 均匀值
        if r == 6:
            y = 3894   # R5/R6 下移
        if r == 7:
            y = 4464   # R6/R7 下移
        if r == 8:
            y = 5094   # R7/R8 下移
        bounds.append(y)
    bounds.append(h)
    return bounds


def is_blank(arr, row, col, row_bounds, col_bounds):
    """通过颜色饱和度和像素方差判断格子是否为空白占位"""
    y1, y2 = row_bounds[row], row_bounds[row + 1]
    x1, x2 = col_bounds[col], col_bounds[col + 1]
    patch = arr[y1:y2, x1:x2, :]

    # 颜色饱和度: RGB 三通道均值的极差
    means = patch.mean(axis=(0, 1))
    saturation = float(means.max() - means.min())

    # 像素方差
    std = float(patch.std(axis=(0, 1)).mean())

    blank = (saturation < BLANK_SATURATION) or (std < BLANK_STD)
    return blank, saturation, std


def main():
    PROJ = os.path.join(os.path.dirname(__file__), "..")
    SOURCE = os.path.join(PROJ, "database", "seed-images", "categories", "手镯.jpg")
    OUT_DIR = os.path.join(PROJ, "database", "seed-images", "items", "bracelets")

    if not os.path.exists(SOURCE):
        print(f"错误: 找不到源图片 {SOURCE}")
        sys.exit(1)

    img = Image.open(SOURCE)
    w, h = img.size
    arr = np.array(img).astype(np.float32)
    print(f"源图片尺寸: {w} × {h}")
    print(f"网格: {COLS}列 × {ROWS}行")
    print(f"margin: L={MARGIN_L} R={MARGIN_R} T={MARGIN_T} B={MARGIN_B}")
    print(f"空白检测: saturation<{BLANK_SATURATION} 或 std<{BLANK_STD}")

    row_bounds = build_row_bounds(h)
    col_bounds = [0, CELL_W, 2 * CELL_W, 3 * CELL_W, w]
    heights = [row_bounds[i + 1] - row_bounds[i] for i in range(ROWS)]
    print(f"行边界: {row_bounds}")
    print(f"行高度: {heights}")

    os.makedirs(OUT_DIR, exist_ok=True)

    idx = 0
    skipped = 0
    for row in range(ROWS):
        for col in range(COLS):
            # 用无 margin 的原始格子判断是否空白
            blank, sat, std = is_blank(arr, row, col, row_bounds, col_bounds)
            if blank:
                skipped += 1
                print(f"  跳过 R{row}C{col} (空白检测: sat={sat:.0f}, std={std:.1f})")
                continue

            idx += 1
            x1 = max(0, col_bounds[col] - MARGIN_L)
            y1 = max(0, row_bounds[row] - MARGIN_T)
            x2 = min(w, col_bounds[col + 1] + MARGIN_R)
            y2 = min(h, row_bounds[row + 1] + MARGIN_B)

            cell = img.crop((x1, y1, x2, y2))
            filename = f"手镯_{idx:02d}.jpg"
            out_path = os.path.join(OUT_DIR, filename)
            cell.save(out_path, quality=95)
            print(f"  已保存 {filename} [{x2-x1}×{y2-y1}] crop=({x1},{y1})-({x2},{y2})")

    print(f"\n完成! 共切分 {idx} 张图片, 跳过 {skipped} 个空白格, 输出目录: {OUT_DIR}")


if __name__ == "__main__":
    main()
