"""
将 database/seed-images/categories/ 中的五张分类图切割为单件首饰图片，
按分类编号存入 database/seed-images/items/。

策略:
  对每张图同时尝试 Canny 边缘（3 组参数）和 Otsu 二值化（3 组参数），
  过滤无效矩形后，选中位数的策略（避免过分割），输出裁剪结果。

用法:
    python scripts/split_images.py              # 自动
    python scripts/split_images.py --debug      # 保存调试图片
"""

import argparse
import re
import shutil
import sys
from pathlib import Path
from typing import Optional, List, Tuple

import cv2
import numpy as np

# ---- 路径 ----
ROOT = Path(__file__).resolve().parent.parent
CATEGORIES_DIR = ROOT / "database" / "seed-images" / "categories"
ITEMS_DIR = ROOT / "database" / "seed-images" / "items"
DEBUG_DIR = ROOT / "database" / "seed-images" / "debug"

CATEGORY_MAP = {
    "发圈": "hair_ties",
    "耳钉": "earrings",
    "项链": "necklaces",
    "手镯": "bracelets",
    "戒指": "rings",
}

# ---- 过滤参数 ----
MIN_CONTOUR_AREA = 3000     # 最小轮廓面积（过滤噪点）
MAX_AREA_RATIO = 0.50       # 超过图像 50% 的矩形视为背景碎片
MAX_DIM_RATIO = 0.92        # 宽或高超过图像 92% 的视为整行/整列
MIN_ASPECT = 0.15           # 最小宽高比（排除极窄条）
MAX_ASPECT = 6.5            # 最大宽高比（排除极扁条）
PADDING = 15


# ---- 文件名解析 ----
def get_base_category(filepath: Path) -> Tuple[str, int]:
    """
    从文件名提取基础分类名和序号。
    '项链_01.jpg' → ('项链', 1),  '发圈.jpg' → ('发圈', 0)
    序号 0 表示无后缀（单文件）。
    """
    stem = filepath.stem
    m = re.match(r"^(.+)_(\d{2})$", stem)
    if m:
        return m.group(1), int(m.group(2))
    return stem, 0


# ---- Unicode-safe I/O ----
def imread_unicode(filepath: Path) -> Optional[np.ndarray]:
    data = np.fromfile(str(filepath), dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def imwrite_unicode(filepath: Path, img: np.ndarray) -> bool:
    success, data = cv2.imencode(".jpg", img)
    if not success:
        return False
    data.tofile(str(filepath))
    return True


# ---- 矩形过滤 ----
def filter_rects(rects: List[Tuple[int, int, int, int]],
                 img_w: int, img_h: int) -> List[Tuple[int, int, int, int]]:
    """过滤过大/过窄/过扁的无效矩形，再按中位面积去除离群值"""
    img_area = img_w * img_h
    ok = []
    for x, y, w, h in rects:
        if w * h < MIN_CONTOUR_AREA:
            continue
        if w * h > img_area * MAX_AREA_RATIO:
            continue
        if w > img_w * MAX_DIM_RATIO or h > img_h * MAX_DIM_RATIO:
            continue
        aspect = w / h if h > 0 else 999
        if aspect < MIN_ASPECT or aspect > MAX_ASPECT:
            continue
        # 加留白
        x = max(0, x - PADDING)
        y = max(0, y - PADDING)
        w = min(img_w - x, w + 2 * PADDING)
        h = min(img_h - y, h + 2 * PADDING)
        ok.append((x, y, w, h))

    # 第二轮: 按中位面积过滤离群值（过大 = 合并簇，过小 = 噪点）
    if len(ok) >= 4:
        areas = [rw * rh for _, _, rw, rh in ok]
        med = sorted(areas)[len(areas) // 2]
        lo = med * 0.08   # 小于中位 8% 的丢弃
        hi = med * 6.0    # 大于中位 6 倍的丢弃
        ok = [(x, y, w, h) for x, y, w, h in ok if lo <= w * h <= hi]

    return ok


# ---- Canny 检测 ----
def detect_canny(img: np.ndarray, low: int, high: int,
                 dilate_iter: int, close_k: int
                 ) -> Tuple[List[Tuple], np.ndarray]:
    h_img, w_img = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, low, high)

    kd = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    dilated = cv2.dilate(edges, kd, iterations=dilate_iter)
    kc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_k, close_k))
    closed = cv2.morphologyEx(dilated, cv2.MORPH_CLOSE, kc)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    raw = [(c, *cv2.boundingRect(c)) for c in contours]
    raw_rects = [(x, y, w, h) for _, x, y, w, h in raw]
    rects = filter_rects(raw_rects, w_img, h_img)
    return sort_rects_by_grid(rects), closed


# ---- Otsu 检测 ----
def detect_otsu(img: np.ndarray, morph_k: int,
                threshold: Optional[int] = None
                ) -> Tuple[List[Tuple], np.ndarray]:
    h_img, w_img = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    if threshold is None:
        _, binary = cv2.threshold(blurred, 0, 255,
                                  cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    else:
        _, binary = cv2.threshold(blurred, threshold, 255, cv2.THRESH_BINARY_INV)

    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (morph_k, morph_k))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, k)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    raw_rects = [cv2.boundingRect(c) for c in contours]
    rects = filter_rects(raw_rects, w_img, h_img)
    return sort_rects_by_grid(rects), closed


# ---- 排序 ----
def sort_rects_by_grid(rects: List[Tuple]) -> List[Tuple]:
    if len(rects) <= 1:
        return rects
    avg_h = sum(r[3] for r in rects) / len(rects)
    tol = max(avg_h * 0.6, 15)
    by_y = sorted(rects, key=lambda r: r[1])
    rows, cur = [], [by_y[0]]
    for r in by_y[1:]:
        if abs(r[1] - cur[0][1]) < tol:
            cur.append(r)
        else:
            rows.append(sorted(cur, key=lambda rr: rr[0]))
            cur = [r]
    rows.append(sorted(cur, key=lambda rr: rr[0]))
    return [r for row in rows for r in row]


# ---- 调试 ----
def save_debug(stem: str, img: np.ndarray, mask: np.ndarray,
               rects: list, label: str):
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    ann = img.copy()
    for i, (x, y, w, h) in enumerate(rects):
        cv2.rectangle(ann, (x, y), (x + w, y + h), (0, 255, 0), 2)
        cv2.putText(ann, str(i + 1), (x + 5, y + 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    imwrite_unicode(DEBUG_DIR / f"{stem}_{label}_annotated.jpg", ann)
    imwrite_unicode(DEBUG_DIR / f"{stem}_{label}_mask.jpg", mask)


# ---- 策略选择 ----
def pick_best(results: dict) -> Tuple[Optional[str], List[Tuple], Optional[np.ndarray]]:
    """
    从多组结果中选出最合理的:
    - 过滤掉数量为 0 的
    - 选接近中位数的（而非最多的），避免过分割
    - 同等条件下选数量更多的
    """
    valid = [(k, r, m) for k, (r, m) in results.items() if len(r) > 0]
    if not valid:
        return None, [], None

    counts = [len(r) for _, r, _ in valid]
    median = sorted(counts)[len(counts) // 2]

    # 找最接近中位数的
    best = min(valid, key=lambda x: abs(len(x[1]) - median))
    return best


# ---- 处理单张 ----
def split_one(filepath: Path, debug: bool = False) -> int:
    stem = filepath.stem
    category_en = CATEGORY_MAP.get(stem)
    if category_en is None:
        print(f"  [跳过] '{stem}' 不在 CATEGORY_MAP")
        return 0

    out_dir = ITEMS_DIR / category_en
    # 清空旧输出
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    img = imread_unicode(filepath)
    if img is None:
        print(f"  [错误] 无法读取: {filepath}")
        return 0

    print(f"  尺寸: {img.shape[1]}x{img.shape[0]}")

    # 运行所有策略
    results = {}
    # Canny: 多组参数 (low, high, dilate_iter, close_kernel)
    canny_params = [
        (30, 100, 2, 7),
        (50, 150, 3, 9),
        (20, 80,  2, 5),
        (15, 60,  2, 3),   # 低阈值 — 捕获微弱边缘
        (40, 120, 4, 11),  # 高膨胀 — 连接更远碎片
        (25, 90,  3, 7),
    ]
    for low, high, dil, ck in canny_params:
        rects, mask = detect_canny(img, low, high, dil, ck)
        results[f"Canny({low},{high},d{dil},k{ck})"] = (rects, mask)

    for mk in [5, 9, 15]:
        rects, mask = detect_otsu(img, mk)
        results[f"Otsu(k{mk})"] = (rects, mask)

    # 选择最佳策略
    best_key, best_rects, best_mask = pick_best(results)

    if not best_rects:
        print(f"  [警告] 所有策略均未检测到物品")
        if debug:
            for k, (r, m) in results.items():
                save_debug(stem, img, m, r, k)
        return 0

    print(f"  选用: {best_key} → {len(best_rects)} 件")

    # 调试输出
    if debug:
        for k, (r, m) in results.items():
            save_debug(stem, img, m, r, k)

    # 保存裁剪
    for idx, (x, y, w, h) in enumerate(best_rects, start=1):
        crop = img[y:y + h, x:x + w]
        out_name = f"{stem}_{idx:02d}.jpg"
        imwrite_unicode(out_dir / out_name, crop)
        print(f"    [{idx}/{len(best_rects)}] {out_name}  ({w}x{h})")

    return len(best_rects)


# ---- 入口 ----
def main():
    parser = argparse.ArgumentParser(description="切分分类图为单件首饰")
    parser.add_argument("--debug", action="store_true",
                        help="保存所有策略的调试图片到 debug/")
    parser.add_argument("--category", type=str, default=None,
                        help="只处理指定分类（如: 手镯）")
    args = parser.parse_args()

    if not CATEGORIES_DIR.is_dir():
        print(f"[错误] 目录不存在: {CATEGORIES_DIR}")
        sys.exit(1)

    print(f"来源: {CATEGORIES_DIR}")
    print(f"输出: {ITEMS_DIR}")
    print()

    jpg_files = sorted(CATEGORIES_DIR.glob("*.jpg"))
    if not jpg_files:
        jpg_files = sorted(CATEGORIES_DIR.glob("*.png"))

    if args.category:
        jpg_files = [f for f in jpg_files
                     if get_base_category(f)[0] == args.category]
        if not jpg_files:
            print(f"[错误] 未找到分类 '{args.category}' 的图片")
            sys.exit(1)

    total = 0
    for fp in jpg_files:
        print(f"[{fp.stem}]")
        total += split_one(fp, args.debug)
        print()

    print(f"===== 共切出 {total} 件 =====")


if __name__ == "__main__":
    main()
