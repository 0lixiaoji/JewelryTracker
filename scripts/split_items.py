"""
将首饰分类图按网格切分成单个首饰图片，自动识别空白占位格并跳过。

用法: python scripts/split_items.py 手镯|项链|戒指

布局参数均配置在 CONFIGS 字典中，运行时自动打印。
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
    "戒指": {
        # 左右双区布局，两区在同一张图中，各自独立编号后合并
        "dual_zone": True,
        "source": "戒指.jpg",
        "out_dir": "rings",
        "prefix": "戒指",
        "blank_saturation": 18,
        "blank_std": 20,
        "blank_logic": "and",  # AND: 两个都低才是空白；戒指金属 sat 可能很低但 std 高
        "left": {
            "cols": 1,
            "rows": 5,
            "cell_w": 244,
            "cell_h": 200,  # 被 row_bounds 覆盖
            "margin_l": 25,
            "margin_r": 25,
            "margin_t": 25,
            "margin_b": 25,
            "x_off": 24,    # 左侧区域起始 x
            # 显式行边界：每个 ring 的起止 y 取中点为界
            # Ring 1: 25-270, 2: 320-560, 3: 625-765, 4: 805-1025, 5: 1050-1280
            "row_bounds": [25, 295, 592, 785, 1037, 1280],
        },
        "right": {
            "cols": 5,
            "rows": 10,
            "cell_w": 281,
            "cell_h": 180,
            "margin_l": 30,
            "margin_r": 30,
            "margin_t": 55,   # Row 0 戒指从 y≈130 开始，适度上边距
            "margin_b": 40,
            "x_off": 279,   # 右侧区域起始 x
            "y_off": 200,   # 右侧区域起始 y
            "traversal": "col-major-rtl",  # 从右上开始，逐列向下，再向左
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
    if cfg.get("blank_logic") == "and":
        blank = (saturation < cfg["blank_saturation"]) and (std < cfg["blank_std"])
    return blank, saturation, std


def process_zone(img, arr, w, h, zone_cfg, cfg, zone_name):
    """处理单个网格区域，返回 [(cell, crop_coords), ...] 列表

    traversal 控制遍历顺序：
    - "row-major"（默认）：逐行从上到下，每行从左到右
    - "col-major-rtl"：逐列从右到左，每列从上到下
    """
    cols = zone_cfg["cols"]
    rows = zone_cfg["rows"]
    cell_w = zone_cfg["cell_w"]
    cell_h = zone_cfg["cell_h"]
    x_off = zone_cfg.get("x_off", 0)
    y_off = zone_cfg.get("y_off", 0)
    ml = zone_cfg.get("margin_l", cfg.get("margin_l", 30))
    mr = zone_cfg.get("margin_r", cfg.get("margin_r", 30))
    mt = zone_cfg.get("margin_t", cfg.get("margin_t", 40))
    mb = zone_cfg.get("margin_b", cfg.get("margin_b", 40))
    traversal = zone_cfg.get("traversal", "row-major")

    # 构建行边界：支持显式指定 row_bounds 覆盖自动计算
    if "row_bounds" in zone_cfg:
        row_bounds = list(zone_cfg["row_bounds"])
    else:
        row_bounds = [y_off + r * cell_h for r in range(rows)] + [y_off + rows * cell_h]
    col_bounds = [x_off + c * cell_w for c in range(cols)] + [x_off + cols * cell_w]

    # 根据 traversal 生成遍历顺序
    if traversal == "col-major-rtl":
        # 从右到左逐列，每列从上到下
        order = [(row, col) for col in range(cols - 1, -1, -1) for row in range(rows)]
    else:
        # 默认：逐行从上到下，每行从左到右
        order = [(row, col) for row in range(rows) for col in range(cols)]

    results = []
    skipped = 0
    for row, col in order:
        y1 = row_bounds[row]
        y2 = row_bounds[row + 1]
        x1 = col_bounds[col]
        x2 = col_bounds[col + 1]

        # 空白检测：同时检查全格子和上部 60%，取较低 std
        # （避免底部边缘伪影和上一行戒指溢出的干扰）
        patch_full = arr[y1:y2, x1:x2, :]
        means_full = patch_full.mean(axis=(0, 1))
        sat_full = float(means_full.max() - means_full.min())
        std_full = float(patch_full.std(axis=(0, 1)).mean())

        detect_h = (y2 - y1) * 3 // 5  # 上部 60%
        patch_top = arr[y1:y1 + detect_h, x1:x2, :]
        means_top = patch_top.mean(axis=(0, 1))
        sat_top = float(means_top.max() - means_top.min())
        std_top = float(patch_top.std(axis=(0, 1)).mean())

        # 取两个窗口中较低的值（更保守地判为空白）
        if std_full < std_top:
            saturation, std = sat_full, std_full
        else:
            saturation, std = sat_top, std_top

        blank_sat = cfg["blank_saturation"]
        blank_std = cfg["blank_std"]
        if cfg.get("blank_logic") == "and":
            blank = (saturation < blank_sat) and (std < blank_std)
        else:
            blank = (saturation < blank_sat) or (std < blank_std)

        if blank:
            skipped += 1
            print(f"  跳过 {zone_name} R{row}C{col} (空白检测: sat={saturation:.0f}, std={std:.1f})")
            continue

        # 裁剪时应用 margin
        cx1 = max(0, x1 - ml)
        cy1 = max(0, y1 - mt)
        cx2 = min(w, x2 + mr)
        cy2 = min(h, y2 + mb)

        cell = img.crop((cx1, cy1, cx2, cy2))
        results.append((cell, (cx1, cy1, cx2, cy2)))

    return results, skipped



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
    print(f"空白检测: saturation<{cfg['blank_saturation']} 或 std<{cfg['blank_std']}")

    os.makedirs(OUT_DIR, exist_ok=True)

    # 清理旧输出文件，避免残留
    for old_file in os.listdir(OUT_DIR):
        if old_file.startswith(cfg["prefix"]) and old_file.endswith(".jpg"):
            os.remove(os.path.join(OUT_DIR, old_file))

    # 双区布局（戒指）：右侧 → 左侧，各自独立编号
    if cfg.get("dual_zone"):
        print(f"左侧区域: {cfg['left']['cols']}列 × {cfg['left']['rows']}行")
        if "row_bounds" in cfg["left"]:
            print(f"  行边界: {cfg['left']['row_bounds']} 起始 x={cfg['left']['x_off']}")
        else:
            print(f"  格子: {cfg['left']['cell_w']}×{cfg['left']['cell_h']} 起始: x={cfg['left']['x_off']}, y={cfg['left']['y_off']}")
        print(f"右侧区域: {cfg['right']['cols']}列 × {cfg['right']['rows']}行")
        print(f"  格子: {cfg['right']['cell_w']}×{cfg['right']['cell_h']} 起始: x={cfg['right']['x_off']}, y={cfg['right']['y_off']}")
        traversal = cfg['right'].get('traversal', 'row-major')
        print(f"  遍历: {traversal}（从右上开始向下，再向左）")

        total_saved = 0
        total_skipped = 0

        # 先处理右侧区域（编号从右上角开始）
        print(f"\n--- 右侧区域 ---")
        right_results, right_skipped = process_zone(img, arr, w, h, cfg["right"], cfg, "右侧")
        total_skipped += right_skipped
        for cell, (x1, y1, x2, y2) in right_results:
            total_saved += 1
            filename = f"{cfg['prefix']}_R_{total_saved:02d}.jpg"
            out_path = os.path.join(OUT_DIR, filename)
            cell.save(out_path, quality=95)
            print(f"  已保存 {filename} [{x2-x1}×{y2-y1}] crop=({x1},{y1})-({x2},{y2})")

        # 再处理左侧区域（独立编号）
        print(f"\n--- 左侧区域 ---")
        left_saved = 0
        left_results, left_skipped = process_zone(img, arr, w, h, cfg["left"], cfg, "左侧")
        total_skipped += left_skipped
        for cell, (x1, y1, x2, y2) in left_results:
            left_saved += 1
            filename = f"{cfg['prefix']}_L_{left_saved:02d}.jpg"
            out_path = os.path.join(OUT_DIR, filename)
            cell.save(out_path, quality=95)
            print(f"  已保存 {filename} [{x2-x1}×{y2-y1}] crop=({x1},{y1})-({x2},{y2})")

        print(f"\n完成! 共切分 {total_saved + left_saved} 张图片 (右{total_saved}+左{left_saved}), 跳过 {total_skipped} 个空白格, 输出目录: {OUT_DIR}")
        return

    # 单区布局（手镯、项链）：原有逻辑
    print(f"网格: {cfg['cols']}列 × {cfg['rows']}行")
    print(f"margin: L={cfg['margin_l']} R={cfg['margin_r']} T={cfg['margin_t']} B={cfg['margin_b']}")

    row_bounds = build_row_bounds(cfg, h)
    col_bounds = [i * cfg["cell_w"] for i in range(cfg["cols"])] + [w]
    heights = [row_bounds[i + 1] - row_bounds[i] for i in range(cfg["rows"])]
    print(f"行边界: {row_bounds}")
    print(f"行高度: {heights}")

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
