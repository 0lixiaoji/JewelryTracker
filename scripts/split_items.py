"""
将首饰分类图按网格切分成单个首饰图片，自动识别空白占位格并跳过。

用法: python scripts/split_items.py 手镯|项链|戒指|发圈

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
    "发圈": {
        # 自由布局：物品不规则排列，右侧 40% 为纯背景
        # 自动检测水平间隙（行分隔）和垂直颜色边缘（列分隔）
        "source": "发圈.jpg",
        "out_dir": "hairties",
        "prefix": "发圈",
        "mode": "freeform",
        "item_area_right": 420,     # 物品区域右边界（右侧 268px 为纯背景）
        "blank_saturation": 18,
        "blank_std": 18,
        "blank_logic": "and",
        "margin_l": 15,
        "margin_r": 15,
        "margin_t": 15,
        "margin_b": 15,
        # 自动检测参数
        "row_valley_threshold": 30,   # 行间隙 std 阈值
        "row_valley_merge": 15,       # 合并邻近行间隙（px）
        "col_peak_merge": 60,         # 合并邻近列边界（px）
        "col_color_merge_dist": 40,   # 合并颜色相近的相邻列（RGB 距离）
        "col_gradient_threshold": 3,  # 列边界检测的梯度阈值
        "tall_band_threshold": 200,   # 超过此高度自动细分
        "sub_peak_merge": 45,         # 细分行时合并邻近中心点（px）
        "sub_row_margin": 0.2,        # 细分行时在中心点之间留 20% 间隙
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


def process_freeform(img, arr, w, h, cfg):
    """自由布局模式：自动检测行间隙和列边界，切分不规则排列的物品。

    算法：
    1. 聚焦物品区域（item_area_right 左侧）
    2. 检测水平间隙（行分隔）——逐行 std 的局部极小值
    3. 将图像分为多个水平 band
    4. 高 band（> tall_band_threshold）自动细分——std 峰值检测
    5. 每个 band/子行内检测垂直列边界——颜色梯度峰值
    6. 合并颜色相近的相邻列（避免物品内部纹理造成的误分割）
    7. 每个 cell 为一个物品，按阅读顺序编号
    """
    item_w = cfg["item_area_right"]
    half = 8  # 局部 std 计算的半窗口

    # --- Step 1: 计算逐行 std ---
    row_std = np.zeros(h)
    for y in range(h):
        y1 = max(0, y - half)
        y2 = min(h, y + half + 1)
        patch = arr[y1:y2, :item_w, :]
        row_std[y] = float(patch.std(axis=(0, 1)).mean())

    row_smooth = np.convolve(row_std, np.ones(15) / 15, mode="same")

    # --- Step 2: 检测水平间隙 ---
    threshold = cfg["row_valley_threshold"]
    merge_dist = cfg["row_valley_merge"]
    valleys = []
    for y in range(10, h - 10):
        window = row_smooth[y - 8:y + 9]
        if row_smooth[y] < threshold and row_smooth[y] == window.min():
            valleys.append(y)

    # 合并邻近 valley
    merged_valleys = []
    for y in valleys:
        if not merged_valleys or y - merged_valleys[-1] > merge_dist:
            merged_valleys.append(y)

    # 构建 band 边界，合并太窄的 band（< 40px 间隙视为噪声）
    band_bounds = [0]
    for y in merged_valleys:
        if y - band_bounds[-1] >= 50:  # 上一个 band 至少 50px 高
            band_bounds.append(y)
    if band_bounds[-1] != h:
        if h - band_bounds[-1] >= 30:
            band_bounds.append(h)
        else:
            band_bounds[-1] = h  # 扩展最后一个 band 到图像底部

    print(f"  检测到 {len(band_bounds) - 1} 个水平 band（{len(merged_valleys)} 条间隙）")

    # --- Step 3: 处理每个 band ---
    col_peak_merge = cfg["col_peak_merge"]
    col_color_merge = cfg["col_color_merge_dist"]
    col_grad_thresh = cfg.get("col_gradient_threshold", 6)
    tall_thresh = cfg["tall_band_threshold"]
    ml = cfg["margin_l"]
    mr = cfg["margin_r"]
    mt = cfg["margin_t"]
    mb = cfg["margin_b"]

    all_items = []  # [(y1, y2, x1, x2), ...]

    for bi in range(len(band_bounds) - 1):
        band_y1 = band_bounds[bi]
        band_y2 = band_bounds[bi + 1]
        band_h = band_y2 - band_y1

        # 检查是否需要细分（高 band）
        if band_h > tall_thresh:
            # 先检查 band 内是否有明显的 std 低谷（< peak_std * 0.6）
            # 如果没有明显低谷，说明是一整个大物品，不应细分
            band_row_std = row_smooth[band_y1:band_y2]
            peak_std_val = np.max(band_row_std)
            min_std_val = np.min(band_row_std[30:-30]) if band_h > 60 else peak_std_val
            has_valley = min_std_val < peak_std_val * 0.55

            if has_valley:
                # 在 band 内找 std 峰值
                sub_peaks = []
                for y in range(band_y1 + 30, band_y2 - 30):
                    if row_smooth[y] > 35 and row_smooth[y] == row_smooth[y - 15:y + 16].max():
                        sub_peaks.append(y)

                # 合并邻近峰值
                merged_sub = []
                for y in sub_peaks:
                    if not merged_sub or y - merged_sub[-1] > cfg["sub_peak_merge"]:
                        merged_sub.append(y)

                if len(merged_sub) >= 2:  # 至少 2 个峰值才细分
                    # 峰值是物品中心，边界在相邻峰值中点（留 margin_ratio 间隙）
                    sub_bounds = [band_y1]
                    for i in range(len(merged_sub) - 1):
                        gap = merged_sub[i + 1] - merged_sub[i]
                        boundary = int(merged_sub[i] + gap * 0.6)
                        sub_bounds.append(boundary)
                    sub_bounds.append(band_y2)

                    # 过滤太窄的子行（< 25px）
                    filtered = [sub_bounds[0]]
                    for b in sub_bounds[1:]:
                        if b - filtered[-1] >= 25:
                            filtered.append(b)
                    sub_bounds = filtered
                    print(f"  Band {bi} (y={band_y1}-{band_y2}, h={band_h}): 细分为 {len(sub_bounds) - 1} 个子行, 中心 y={merged_sub}")
                else:
                    sub_bounds = [band_y1, band_y2]
                    print(f"  Band {bi} (y={band_y1}-{band_y2}, h={band_h}): std 峰值不足，不细分")
            else:
                sub_bounds = [band_y1, band_y2]
                print(f"  Band {bi} (y={band_y1}-{band_y2}, h={band_h}): 无 std 低谷（peak={peak_std_val:.0f}, min={min_std_val:.0f}），整体作为一个物品")
        else:
            sub_bounds = [band_y1, band_y2]

        # --- Step 4: 对每个子行检测列边界 ---
        for si in range(len(sub_bounds) - 1):
            sy1, sy2 = sub_bounds[si], sub_bounds[si + 1]
            sub_band = arr[sy1:sy2, :item_w, :]

            # 逐列平均颜色
            col_means = np.zeros((item_w, 3))
            for x in range(item_w):
                col_means[x] = sub_band[:, x, :].mean(axis=0)

            # 相邻列颜色差异
            col_diff = np.zeros(item_w)
            for x in range(1, item_w):
                col_diff[x] = np.sqrt(np.sum((col_means[x] - col_means[x - 1]) ** 2))
            col_diff_smooth = np.convolve(col_diff, np.ones(15) / 15, mode="same")

            # 找峰值（使用可配置的梯度阈值）
            peaks = []
            for x in range(15, item_w - 15):
                wnd = col_diff_smooth[x - 8:x + 9]
                if col_diff_smooth[x] > col_grad_thresh and col_diff_smooth[x] == wnd.max():
                    peaks.append(x)

            # 合并邻近峰值
            merged_peaks = []
            for x in peaks:
                if not merged_peaks or x - merged_peaks[-1] > col_peak_merge:
                    merged_peaks.append(x)

            # --- Step 5: 合并颜色相近的相邻列 ---
            # 计算每列段的平均颜色，合并颜色相近的
            if merged_peaks:
                col_bounds = [0] + merged_peaks + [item_w]
                seg_colors = []
                for ci in range(len(col_bounds) - 1):
                    cx1, cx2 = col_bounds[ci], col_bounds[ci + 1]
                    seg = sub_band[:, cx1:cx2, :]
                    seg_colors.append(seg.mean(axis=(0, 1)))

                # 贪心合并
                final_bounds = [0]
                last_color = seg_colors[0]
                for ci in range(1, len(seg_colors)):
                    color_dist = np.sqrt(np.sum((seg_colors[ci] - last_color) ** 2))
                    if color_dist < col_color_merge:
                        # 合并：跳过这个边界
                        pass
                    else:
                        final_bounds.append(col_bounds[ci])
                        last_color = seg_colors[ci]
                final_bounds.append(item_w)
            else:
                final_bounds = [0, item_w]

            # --- Step 6: 生成物品 ---
            for ci in range(len(final_bounds) - 1):
                cx1, cx2 = final_bounds[ci], final_bounds[ci + 1]
                item_w_px = cx2 - cx1
                item_h_px = sy2 - sy1

                # 跳过太窄或太矮的（< 55px 宽的列段，< 30px 高的行）
                if item_w_px < 55 or item_h_px < 30:
                    continue

                # 应用 margin
                ix1 = max(0, cx1 - ml)
                iy1 = max(0, sy1 - mt)
                ix2 = min(w, cx2 + mr)
                iy2 = min(h, sy2 + mb)

                all_items.append((iy1, iy2, ix1, ix2))

    # 对超宽物品（> item_area_right * 0.7）尝试用更低阈值二次分裂
    wide_threshold = int(cfg["item_area_right"] * 0.7)
    refined_items = []
    for y1, y2, x1, x2 in all_items:
        item_w_px = x2 - x1
        if item_w_px > wide_threshold:
            # 尝试用更敏感的颜色阈值重新检测该物品内的列边界
            sub_band = arr[y1:y2, x1:x2, :]
            sub_w = x2 - x1
            col_means = np.zeros((sub_w, 3))
            for x in range(sub_w):
                col_means[x] = sub_band[:, x, :].mean(axis=0)
            col_diff = np.zeros(sub_w)
            for x in range(1, sub_w):
                col_diff[x] = np.sqrt(np.sum((col_means[x] - col_means[x - 1]) ** 2))
            col_diff_smooth = np.convolve(col_diff, np.ones(10) / 10, mode="same")
            # 更低的峰值检测阈值（用于二次分裂）
            peaks = []
            for x in range(15, sub_w - 15):
                wnd = col_diff_smooth[x - 8:x + 9]
                if col_diff_smooth[x] > col_grad_thresh * 0.5 and col_diff_smooth[x] == wnd.max():
                    peaks.append(x)
            # 合并邻近
            merged = []
            for x in peaks:
                if not merged or x - merged[-1] > 40:
                    merged.append(x)
            if len(merged) >= 1:
                # 找到了子边界，分裂宽物品
                sub_bounds = [0] + merged + [sub_w]
                for ci in range(len(sub_bounds) - 1):
                    sx1 = x1 + sub_bounds[ci]
                    sx2 = x1 + sub_bounds[ci + 1]
                    if sx2 - sx1 >= 55:
                        refined_items.append((y1, y2, sx1, sx2))
                # 如果所有子项都太窄，保留原物品
                if not any(sx2 - sx1 >= 55 for sx1, sx2 in
                          [(x1 + sub_bounds[ci], x1 + sub_bounds[ci + 1])
                           for ci in range(len(sub_bounds) - 1)]):
                    refined_items.append((y1, y2, x1, x2))
            else:
                refined_items.append((y1, y2, x1, x2))
        else:
            refined_items.append((y1, y2, x1, x2))
    all_items = refined_items

    # 后处理 1：垂直合并——同一物品在相邻子行中的碎片
    # 仅在水平重叠 > 60%、颜色相近（距离 < 40）、垂直间隙 < 20px 时合并
    if len(all_items) > 1:
        all_items.sort(key=lambda item: (item[0], item[2]))
        merged = []
        used = [False] * len(all_items)
        for i in range(len(all_items)):
            if used[i]:
                continue
            iy1, iy2, ix1, ix2 = all_items[i]
            group = [(iy1, iy2, ix1, ix2)]
            used[i] = True
            for j in range(i + 1, len(all_items)):
                if used[j]:
                    continue
                jy1, jy2, jx1, jx2 = all_items[j]
                # 垂直间隙 < 20px
                if jy1 > iy2 + 20:
                    break  # 已排序，后续更远
                v_gap = max(0, jy1 - iy2) if jy1 >= iy2 else max(0, iy1 - jy2)
                if v_gap > 20:
                    continue
                # 水平重叠 > 60%
                overlap_x = min(ix2, jx2) - max(ix1, jx1)
                min_w = min(ix2 - ix1, jx2 - jx1)
                if min_w <= 0 or overlap_x / min_w < 0.6:
                    continue
                # 颜色相近
                pi = arr[iy1:iy2, ix1:ix2, :]
                pj = arr[jy1:jy2, jx1:jx2, :]
                color_dist = np.sqrt(np.sum((pi.mean(axis=(0,1)) - pj.mean(axis=(0,1))) ** 2))
                if color_dist < 40:
                    group.append((jy1, jy2, jx1, jx2))
                    used[j] = True
            gy1 = min(m[0] for m in group)
            gy2 = max(m[1] for m in group)
            gx1 = min(m[2] for m in group)
            gx2 = max(m[3] for m in group)
            merged.append((gy1, gy2, gx1, gx2))
        all_items = merged
        print(f"  垂直合并后: {len(all_items)} 个物品")

    # 后处理 2：去重——水平合并（同 y 范围、水平相邻、颜色相近的物品）
    if len(all_items) > 1:
        all_items.sort(key=lambda item: (item[0], item[2]))
        merged_h = []
        used = [False] * len(all_items)
        for i in range(len(all_items)):
            if used[i]:
                continue
            iy1, iy2, ix1, ix2 = all_items[i]
            group = [(iy1, iy2, ix1, ix2)]
            used[i] = True
            for j in range(i + 1, len(all_items)):
                if used[j]:
                    continue
                jy1, jy2, jx1, jx2 = all_items[j]
                # 垂直重叠 > 85%（同一行）
                overlap_y = min(iy2, jy2) - max(iy1, jy1)
                min_h = min(iy2 - iy1, jy2 - jy1)
                if min_h <= 0 or overlap_y / min_h < 0.85:
                    continue
                # 水平间隙 < 5px 或轻微重叠
                h_gap = max(jx1 - ix2, ix1 - jx2)
                if h_gap > 5:
                    continue
                # 颜色检查
                pi = arr[iy1:iy2, ix1:ix2, :]
                pj = arr[jy1:jy2, jx1:jx2, :]
                color_dist = np.sqrt(np.sum((pi.mean(axis=(0,1)) - pj.mean(axis=(0,1))) ** 2))
                if color_dist < 45:
                    group.append((jy1, jy2, jx1, jx2))
                    used[j] = True
            gy1 = min(m[0] for m in group)
            gy2 = max(m[1] for m in group)
            gx1 = min(m[2] for m in group)
            gx2 = max(m[3] for m in group)
            merged_h.append((gy1, gy2, gx1, gx2))
        all_items = merged_h

    # 后处理 3：包含合并——若小物品被大物品大幅覆盖，吸收碎片
    if len(all_items) > 1:
        all_items.sort(key=lambda item: (item[1] - item[0]) * (item[3] - item[2]), reverse=True)
        merged_contain = []
        used = [False] * len(all_items)
        for i in range(len(all_items)):
            if used[i]:
                continue
            iy1, iy2, ix1, ix2 = all_items[i]
            i_area = (iy2 - iy1) * (ix2 - ix1)
            group = [(iy1, iy2, ix1, ix2)]
            used[i] = True
            for j in range(len(all_items)):
                if used[j] or i == j:
                    continue
                jy1, jy2, jx1, jx2 = all_items[j]
                j_area = (jy2 - jy1) * (jx2 - jx1)
                overlap_y = max(0, min(iy2, jy2) - max(iy1, jy1))
                overlap_x = max(0, min(ix2, jx2) - max(ix1, jx1))
                if overlap_y <= 0 or overlap_x <= 0:
                    continue
                overlap_area = overlap_y * overlap_x
                # j > 75% 被 i 覆盖 → 碎片，无条件吸收
                # 或块颜色相近且 > 50% 被覆盖
                if overlap_area / j_area > 0.75:
                    group.append((jy1, jy2, jx1, jx2))
                    used[j] = True
                elif overlap_area / j_area > 0.5:
                    pi = arr[iy1:iy2, ix1:ix2, :]
                    pj = arr[jy1:jy2, jx1:jx2, :]
                    color_dist = np.sqrt(np.sum((pi.mean(axis=(0,1)) - pj.mean(axis=(0,1))) ** 2))
                    if color_dist < 45:
                        group.append((jy1, jy2, jx1, jx2))
                        used[j] = True
            gy1 = min(m[0] for m in group)
            gy2 = max(m[1] for m in group)
            gx1 = min(m[2] for m in group)
            gx2 = max(m[3] for m in group)
            merged_contain.append((gy1, gy2, gx1, gx2))
        all_items = merged_contain

    return all_items


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

    # 自由布局（发圈）：自动检测行间隙和列边界
    if cfg.get("mode") == "freeform":
        print(f"物品区域: 0-{cfg['item_area_right']}px（右侧 {w - cfg['item_area_right']}px 为纯背景）")
        print(f"行间隙阈值: std<{cfg['row_valley_threshold']}")
        print(f"高 band 细分阈值: >{cfg['tall_band_threshold']}px")
        print(f"margin: L={cfg['margin_l']} R={cfg['margin_r']} T={cfg['margin_t']} B={cfg['margin_b']}")

        items = process_freeform(img, arr, w, h, cfg)

        total_saved = 0
        for y1, y2, x1, x2 in items:
            total_saved += 1
            cell = img.crop((x1, y1, x2, y2))
            filename = f"{cfg['prefix']}_{total_saved:02d}.jpg"
            out_path = os.path.join(OUT_DIR, filename)
            cell.save(out_path, quality=95)
            print(f"  已保存 {filename} [{x2-x1}×{y2-y1}] crop=({x1},{y1})-({x2},{y2})")

        print(f"\n完成! 共切分 {total_saved} 张图片, 输出目录: {OUT_DIR}")
        return

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
