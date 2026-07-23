"""
将首饰分类图按网格切分成单个首饰图片，自动识别空白占位格并跳过。

用法: python scripts/split_items.py 手镯|项链

手镯: 4列×9行, 540×630/格, 非对称margin, 输出到 items/bracelets/
项链: 9列×5行, 240×283/格, 输出到 items/necklaces/
"""

from PIL import Image
import numpy as np
import os
import sys

# --- 各类型参数配置 ---
CONFIGS = {
    "手镯": {
        "cols": 4,
        "rows": 9,
        "cell_w": 540,
        "cell_h": 630,
        "y_off": 4,
        "margin_l": 180,
        "margin_r": 75,
        "margin_t": 20,
        "margin_b": 100,
        "blank_saturation": 25,
        "blank_std": 15,
        "source": "手镯.jpg",
        "out_dir": "bracelets",
        "prefix": "手镯",
        # 已知行边界修正（格间暗线位置）
        "row_bound_corrections": {1: None, 2: None, 3: None, 4: 2583, 5: 3154, 6: 3894, 7: 4464, 8: 5094},
    },
    "项链": {
        "cols": 9,
        "rows": 5,
        "cell_w": 240,
        "cell_h": 283,
        "y_off": 0,
        "margin_l": 85,
        "margin_r": 40,
        "margin_t": 15,
        "margin_b": 15,
        "blank_saturation": 30,
        "blank_std": 15,
        "source": "项链.jpg",
        "out_dir": "necklaces",
        "prefix": "项链",
        # 行边界（格间暗线位于 y=279, 572, 846, 1131）
        "row_bound_corrections": {1: 279, 2: 572, 3: 846, 4: 1131},
        # 按行微调 margin（项链重心逐行偏移）
        "row_margins": {
            1: {"margin_l": 120},  # Row 1 项链整体偏右，需更多左边距
            4: {"margin_r": 55},   # Row 4 项链整体偏左，需更多右边距
        },
    },
}


def build_row_bounds(cfg, h):
    """构建行边界列表"""
    bounds = [0]
    for r in range(1, cfg["rows"]):
        y = cfg["y_off"] + r * cfg["cell_h"]
        correction = cfg["row_bound_corrections"].get(r)
        if correction is not None:
            y = correction
        bounds.append(y)
    bounds.append(h)
    return bounds


def is_blank(arr, row, col, row_bounds, col_bounds, cfg):
    """通过颜色饱和度和像素方差判断格子是否为空白占位"""
    y1, y2 = row_bounds[row], row_bounds[row + 1]
    x1, x2 = col_bounds[col], col_bounds[col + 1]
    patch = arr[y1:y2, x1:x2, :]

    means = patch.mean(axis=(0, 1))
    saturation = float(means.max() - means.min())

    std = float(patch.std(axis=(0, 1)).mean())

    blank = (saturation < cfg["blank_saturation"]) or (std < cfg["blank_std"])
    return blank, saturation, std


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in CONFIGS:
        types = ", ".join(CONFIGS.keys())
        print(f"用法: python {sys.argv[0]} <类型>")
        print(f"可用类型: {types}")
        sys.exit(1)

    typ = sys.argv[1]
    cfg = CONFIGS[typ]

    PROJ = os.path.join(os.path.dirname(__file__), "..")
    SOURCE = os.path.join(PROJ, "database", "seed-images", "categories", cfg["source"])
    OUT_DIR = os.path.join(PROJ, "database", "seed-images", "items", cfg["out_dir"])

    if not os.path.exists(SOURCE):
        print(f"错误: 找不到源图片 {SOURCE}")
        sys.exit(1)

    img = Image.open(SOURCE)
    w, h = img.size
    arr = np.array(img).astype(np.float32)
    print(f"类型: {typ}")
    print(f"源图片: {cfg['source']} 尺寸: {w} × {h}")
    print(f"网格: {cfg['cols']}列 × {cfg['rows']}行")
    print(f"margin: L={cfg['margin_l']} R={cfg['margin_r']} T={cfg['margin_t']} B={cfg['margin_b']}")
    print(f"空白检测: saturation<{cfg['blank_saturation']} 或 std<{cfg['blank_std']}")

    row_bounds = build_row_bounds(cfg, h)
    col_bounds = [i * cfg["cell_w"] for i in range(cfg["cols"])] + [w]
    heights = [row_bounds[i + 1] - row_bounds[i] for i in range(cfg["rows"])]
    print(f"行边界: {row_bounds}")
    print(f"行高度: {heights}")

    os.makedirs(OUT_DIR, exist_ok=True)

    idx = 0
    skipped = 0
    for row in range(cfg["rows"]):
        for col in range(cfg["cols"]):
            blank, sat, std = is_blank(arr, row, col, row_bounds, col_bounds, cfg)
            if blank:
                skipped += 1
                print(f"  跳过 R{row}C{col} (空白检测: sat={sat:.0f}, std={std:.1f})")
                continue

            idx += 1
            # 按行覆盖 margin（如有配置）
            rm = cfg.get("row_margins", {}).get(row, {})
            ml = rm.get("margin_l", cfg["margin_l"])
            mr = rm.get("margin_r", cfg["margin_r"])
            mt = rm.get("margin_t", cfg["margin_t"])
            mb = rm.get("margin_b", cfg["margin_b"])
            x1 = max(0, col_bounds[col] - ml)
            y1 = max(0, row_bounds[row] - mt)
            x2 = min(w, col_bounds[col + 1] + mr)
            y2 = min(h, row_bounds[row + 1] + mb)

            cell = img.crop((x1, y1, x2, y2))
            filename = f"{cfg['prefix']}_{idx:02d}.jpg"
            out_path = os.path.join(OUT_DIR, filename)
            cell.save(out_path, quality=95)
            print(f"  已保存 {filename} [{x2-x1}×{y2-y1}] crop=({x1},{y1})-({x2},{y2})")

    print(f"\n完成! 共切分 {idx} 张图片, 跳过 {skipped} 个空白格, 输出目录: {OUT_DIR}")


if __name__ == "__main__":
    main()
