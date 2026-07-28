"""
种子图片切割脚本 —— 将分类合成图中的首饰逐一切割并编号保存。

完全自动化，零硬编码：自适应阈值 → 碎片提取 → 2D 聚类 → 过宽切分。

用法:
    python scripts/split_items.py <分类名>
    python scripts/split_items.py 手镯 --dry-run

输出:
    database/seed-images/items/{英文目录名}/{中文分类名}_1.jpg, ...
"""

import cv2
import numpy as np
from PIL import Image
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CATEGORY_MAP = {
    "发圈": "hairties",
    "耳钉": "earrings",
    "项链": "necklaces",
    "手镯": "bracelets",
    "戒指": "rings",
}


# =============================================================================
# 工具
# =============================================================================

def smooth1d(data, kernel_size):
    k = np.ones(kernel_size) / kernel_size
    return np.convolve(data, k, mode='same')


def extract_fragments(mask, min_area=3000):
    """从二值掩码中提取显著前景碎片。"""
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        mask, connectivity=8)
    frags = []
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        x = stats[i, cv2.CC_STAT_LEFT]
        y = stats[i, cv2.CC_STAT_TOP]
        w = stats[i, cv2.CC_STAT_WIDTH]
        h = stats[i, cv2.CC_STAT_HEIGHT]
        if area < min_area or w < 50 or h < 50:
            continue
        if w > mask.shape[1] * 0.9:
            continue
        frags.append({
            'x': x, 'y': y, 'w': w, 'h': h,
            'x2': x + w, 'y2': y + h,
            'cx': centroids[i][0], 'cy': centroids[i][1],
            'area': area,
        })
    return frags


# =============================================================================
# 2D 聚类合并
# =============================================================================

def cluster_fragments_2d(fragments, image_w, image_h):
    """
    对碎片进行 2D 空间聚类。使用并查集，两个碎片合并条件：

    A. X 重叠 >30% 且 Y 重叠 >30% → 邻接碎片
    B. X 重叠 >60% 且 Y 间隙 < 碎片中位高度×0.3 且合并后高度 < 中位高度×2.0
       → 竖直堆叠（允许 tall items，但防止无限制链式合并）
    C. Y 重叠 >60% 且 X 间隙 < 碎片中位宽度×0.3 且合并后宽度 < 中位宽度×1.6
       → 水平邻接
    """
    n = len(fragments)
    if n <= 1:
        return fragments

    med_w = np.median([f['w'] for f in fragments])
    med_h = np.median([f['h'] for f in fragments])
    if med_w <= 0:
        med_w = 300
    if med_h <= 0:
        med_h = 300

    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(n):
        a = fragments[i]
        for j in range(i + 1, n):
            b = fragments[j]

            x_ov = max(0, min(a['x2'], b['x2']) - max(a['x'], b['x']))
            y_ov = max(0, min(a['y2'], b['y2']) - max(a['y'], b['y']))
            x_gap = max(0, max(a['x'], b['x']) - min(a['x2'], b['x2']))
            y_gap = max(0, max(a['y'], b['y']) - min(a['y2'], b['y2']))

            x_min_w = min(a['w'], b['w'])
            y_min_h = min(a['h'], b['h'])
            x_ratio = x_ov / x_min_w if x_min_w > 0 else 0
            y_ratio = y_ov / y_min_h if y_min_h > 0 else 0

            combined_w = max(a['x2'], b['x2']) - min(a['x'], b['x'])
            combined_h = max(a['y2'], b['y2']) - min(a['y'], b['y'])

            merge = False

            # A: 双方向重叠
            if x_ratio > 0.3 and y_ratio > 0.3:
                merge = True
            # B: 竖直堆叠（X 高度对齐 + Y 间隙小）
            elif (x_ratio > 0.6 and y_gap < med_h * 0.35
                  and combined_h < med_h * 3.0):
                merge = True
            # C: 水平邻接（Y 高度对齐 + X 间隙小）
            elif (y_ratio > 0.6 and x_gap < med_w * 0.3
                  and combined_w < med_w * 1.6):
                merge = True

            if merge:
                union(i, j)

    groups = {}
    for i in range(n):
        root = find(i)
        groups.setdefault(root, []).append(fragments[i])

    result = []
    for comps in groups.values():
        x = min(c['x'] for c in comps)
        y = min(c['y'] for c in comps)
        x2 = max(c['x2'] for c in comps)
        y2 = max(c['y2'] for c in comps)
        result.append({'x': x, 'y': y, 'x2': x2, 'y2': y2,
                       'w': x2 - x, 'h': y2 - y})

    return result


def split_tall(merged_items, med_h):
    """过高物品（> 1.8× 中位高度）等分切分，最多切 3 份。"""
    if not merged_items or med_h <= 0:
        return merged_items
    result = []
    for it in merged_items:
        h = it['h']
        if h < med_h * 1.8:
            result.append(it)
            continue
        n_parts = max(2, min(3, round(h / med_h)))
        ph = h // n_parts
        for k in range(n_parts):
            y1 = it['y'] + k * ph
            y2 = it['y'] + (k + 1) * ph if k < n_parts - 1 else it['y2']
            result.append({'x': it['x'], 'y': y1, 'x2': it['x2'], 'y2': y2,
                           'w': it['w'], 'h': y2 - y1})
    return result


def split_wide(merged_items, med_w):
    """过宽物品（> 1.7× 中位宽度）等分切分，最多切 3 份。"""
    if not merged_items or med_w <= 0:
        return merged_items
    result = []
    for it in merged_items:
        w = it['w']
        if w < med_w * 1.7:
            result.append(it)
            continue
        n_parts = max(2, min(3, round(w / med_w)))
        pw = w // n_parts
        for k in range(n_parts):
            x1 = it['x'] + k * pw
            x2 = it['x'] + (k + 1) * pw if k < n_parts - 1 else it['x2']
            result.append({'x': x1, 'y': it['y'], 'x2': x2, 'y2': it['y2'],
                           'w': x2 - x1, 'h': it['h']})
    return result


# =============================================================================
# 主算法：先切主要 band → 每 band 内 2D 聚类 → 过宽切分
# =============================================================================

def find_all_valleys(row_profile, min_width=30, threshold_ratio=0.7):
    """
    找全部行间隙：密度 < 中位数 × threshold_ratio 且宽度 > min_width。
    用较宽松的阈值捕获所有潜在的行间隙。
    """
    median = np.median(row_profile)
    threshold = median * threshold_ratio
    is_valley = row_profile < threshold

    changes = np.diff(np.concatenate([[False], is_valley, [False]]).astype(int))
    starts = np.where(changes == 1)[0]
    ends = np.where(changes == -1)[0] - 1

    valleys = []
    for s, e in zip(starts, ends):
        if e - s >= min_width and s > 10 and e < len(row_profile) - 10:
            valleys.append((s, e))
    return valleys


def _gradient_expand(gray_img, start, direction, y1, y2, x1, x2, max_steps=80):
    """
    沿方向逐像素扫描，直到遇到显著梯度变化（物品→背景的边界）。

    比较相邻两列/行的均值差。差值突然增大 → 边缘 → 停止。
    返回值: 新边界位置（像素坐标）
    """
    h, w = gray_img.shape

    for step in range(1, max_steps + 1):
        if direction == 'right':
            cur_x = start + step
            if cur_x >= w:
                return w
            prev_col = gray_img[y1:y2, cur_x - 1].astype(float)
            cur_col = gray_img[y1:y2, cur_x].astype(float)
        elif direction == 'left':
            cur_x = start - step
            if cur_x < 0:
                return 0
            prev_col = gray_img[y1:y2, cur_x + 1].astype(float)
            cur_col = gray_img[y1:y2, cur_x].astype(float)
        elif direction == 'down':
            cur_y = start + step
            if cur_y >= h:
                return h
            prev_row = gray_img[cur_y - 1, x1:x2].astype(float)
            cur_row = gray_img[cur_y, x1:x2].astype(float)
        elif direction == 'up':
            cur_y = start - step
            if cur_y < 0:
                return 0
            prev_row = gray_img[cur_y + 1, x1:x2].astype(float)
            cur_row = gray_img[cur_y, x1:x2].astype(float)
        else:
            return start

        if direction in ('right', 'left'):
            prev_mean = np.mean(prev_col)
            cur_mean = np.mean(cur_col)
        else:
            prev_mean = np.mean(prev_row)
            cur_mean = np.mean(cur_row)

        # 相邻列/行均值变化超过 8% → 检测到边缘
        if prev_mean > 0 and abs(cur_mean - prev_mean) / prev_mean > 0.08:
            if direction == 'right':
                return cur_x - 1
            elif direction == 'left':
                return cur_x + 1
            elif direction == 'down':
                return cur_y - 1
            else:  # up
                return cur_y + 1

    # 达到最大步数，返回最远位置
    if direction == 'right':
        return min(w, start + max_steps)
    elif direction == 'left':
        return max(0, start - max_steps)
    elif direction == 'down':
        return min(h, start + max_steps)
    else:  # up
        return max(0, start - max_steps)


def extract_items(mask_orig, mask_dilated, gray_img, full_h):
    """
    从整张二值掩码中提取所有物品包围盒。

    mask_orig: 原始掩码 → 用于行间隙检测（保留间隙）
    mask_dilated: 膨胀掩码 → 用于碎片提取
    gray_img: 原图灰度 → 用于自适应边缘扩展

    流程：
    1. 原始掩码找行间隙 → 切分为 band
    2. 每 band 内用膨胀掩码提取碎片 → 2D 聚类
    3. 过宽/过高切分
    4. 原图灰度自适应边缘扩展 + 过滤 + 排序
    """
    full_w = mask_orig.shape[1]

    # ---- 步骤1：原始掩码的行间隙切分 ----
    row_fg = np.sum(mask_orig > 0, axis=1) / full_w
    row_smooth = smooth1d(row_fg, 30)

    valleys = find_all_valleys(row_smooth, min_width=30, threshold_ratio=0.7)
    print(f"  行间隙: {len(valleys)} 个")

    h_cuts = [0] + [(s + e) // 2 for s, e in valleys] + [full_h]
    bands = [(h_cuts[i], h_cuts[i + 1])
             for i in range(len(h_cuts) - 1)
             if h_cuts[i + 1] - h_cuts[i] >= 100]
    print(f"  → {len(bands)} 个 band")

    # ---- 步骤2：每 band 内用膨胀掩码提取碎片 + 2D 聚类 ----
    all_results = []

    for band_idx, (y1, y2) in enumerate(bands):
        band_mask = mask_dilated[y1:y2, :]  # 用膨胀掩码提取碎片
        frags = extract_fragments(band_mask)

        # 转为全局坐标
        for f in frags:
            f['y'] += y1
            f['y2'] += y1
            f['cy'] += y1

        if not frags:
            continue

        clustered = cluster_fragments_2d(frags, full_w, y2 - y1)

        for c in clustered:
            all_results.append(c)

        if len(clustered) > 0:
            widths = [c['w'] for c in clustered]
            print(f"  Band {band_idx} ({y1}–{y2}, h={y2-y1}): "
                  f"{len(frags)} 碎片 → {len(clustered)} 物品, "
                  f"宽 {min(widths):.0f}–{max(widths):.0f}")

    if not all_results:
        return []

    # ---- 步骤3：全局过宽、过高切分 ----
    global_med_w = np.median([c['w'] for c in all_results])
    global_med_h = np.median([c['h'] for c in all_results])
    print(f"  全局中位尺寸: {global_med_w:.0f}×{global_med_h:.0f}px")
    all_results = split_wide(all_results, global_med_w)
    all_results = split_tall(all_results, global_med_h)

    # ---- 步骤4：自适应边缘扩展 + 过滤 + 排序 ----
    # 用原图灰度扫描每个物品的四边，逐像素扩展到真正的背景边界，
    # 然后加少量固定 padding 作为留白。
    results = []
    for c in all_results:
        x1, y1 = c['x'], c['y']
        x2, y2 = c['x2'], c['y2']

    # ---- 步骤4：自适应边缘修剪 + 比例扩展 + 过滤 + 排序 ----
    results = []
    for c in all_results:
        fx1, fy1 = c['x'], c['y']
        fx2, fy2 = c['x2'], c['y2']
        fw, fh = fx2 - fx1, fy2 - fy1

        # 用掩码修剪左/下边缘的空白列/行（前景密度 < 3%）
        region = mask_orig[fy1:fy2, fx1:fx2]
        col_fg = np.sum(region > 0, axis=0) / max(1, fh)
        row_fg = np.sum(region > 0, axis=1) / max(1, fw)

        # 找第一个有效列/行
        left_content = np.where(col_fg > 0.03)[0]
        right_content = np.where(col_fg > 0.03)[0]
        top_content = np.where(row_fg > 0.03)[0]
        bottom_content = np.where(row_fg > 0.03)[0]

        # 修剪空白边缘（但保留至少 60% 的原宽度/高度）
        if len(left_content) > 0:
            trim_l = min(left_content[0], int(fw * 0.2))
            fx1 += trim_l
        if len(right_content) > 0:
            trim_r = min(fw - 1 - right_content[-1], int(fw * 0.1))
            fx2 -= trim_r
        if len(top_content) > 0:
            trim_t = min(top_content[0], int(fh * 0.2))
            fy1 += trim_t
        if len(bottom_content) > 0:
            trim_b = min(fh - 1 - bottom_content[-1], int(fh * 0.1))
            fy2 -= trim_b

        # 比例扩展：每边扩展宽度/高度的 18%（至少 20px，最多 100px）
        expand_x = max(20, min(100, int(fw * 0.18)))
        expand_y = max(20, min(100, int(fh * 0.18)))
        x1 = max(0, fx1 - expand_x)
        y1 = max(0, fy1 - expand_y)
        x2 = min(full_w, fx2 + expand_x)
        y2 = min(full_h, fy2 + expand_y)

        w, h = x2 - x1, y2 - y1
        if w < 150 or h < 150:
            continue
        if w > full_w * 0.9:
            continue
        results.append((x1, y1, w, h))

    results.sort(key=lambda r: (r[1], r[0]))
    return results


# =============================================================================
# 入口
# =============================================================================

def split_category(category_cn, dry_run=False):
    """切割一个分类的合成图。"""
    category_en = CATEGORY_MAP[category_cn]

    img_path = ROOT / "database" / "seed-images" / "categories" / f"{category_cn}.jpg"
    if not img_path.exists():
        print(f"错误：找不到图片 {img_path}")
        return

    out_dir = ROOT / "database" / "seed-images" / "items" / category_en
    out_dir.mkdir(parents=True, exist_ok=True)

    pil_img = Image.open(str(img_path))
    img = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)
    h, w = img.shape[:2]
    print(f"已加载: {img_path.name} ({w}×{h})")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mask = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 51, 10)

    items = extract_items(mask, mask, gray, h)

    print(f"\n共检测到 {len(items)} 件物品:")
    for idx, (x, y, iw, ih) in enumerate(items, start=1):
        print(f"  物品 {idx}: ({x}, {y}, {iw}, {ih})")

    if dry_run:
        print("\n[仅分析模式] 未写入文件。")
        return

    saved = 0
    for idx, (x, y, iw, ih) in enumerate(items, start=1):
        crop = img[y:y + ih, x:x + iw, :]
        out_name = f"{category_cn}_{idx}.jpg"
        out_path = out_dir / out_name
        crop_rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        Image.fromarray(crop_rgb).save(str(out_path), quality=95)
        print(f"  已保存: {out_name} ({iw}×{ih})")
        saved += 1

    print(f"\n完成！共 {saved} 件 → {out_dir}")
    gitkeep = out_dir / ".gitkeep"
    if gitkeep.exists() and saved > 0:
        gitkeep.unlink()


def main():
    p = argparse.ArgumentParser(description="种子图片切割工具")
    p.add_argument("category", nargs="?", default="手镯",
                   choices=["手镯", "发圈", "耳钉", "项链", "戒指", "all"])
    p.add_argument("--dry-run", "-n", action="store_true",
                   help="仅分析不保存")
    args = p.parse_args()

    if args.category == "all":
        for cat in CATEGORY_MAP:
            print(f"\n{'='*50}\n正在处理: {cat}\n{'='*50}")
            split_category(cat, dry_run=args.dry_run)
    else:
        split_category(args.category, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
