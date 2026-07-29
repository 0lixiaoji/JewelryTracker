"""批量导入种子图片 — 将 seed-images/items/ 下所有图片录入数据库"""

import os
import shutil
import sys
import uuid
from pathlib import Path

# 确保能 import backend.database
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pymysql
from backend.database import DB_CONFIG

SEED_DIR = Path(__file__).resolve().parent / "seed-images" / "items"
UPLOADS_DIR = Path(__file__).resolve().parent.parent / "backend" / "uploads"

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def main():
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    conn = pymysql.connect(**DB_CONFIG)
    cur = conn.cursor()

    # 获取分类名→ID 映射
    cur.execute("SELECT id, name_zh FROM categories ORDER BY sort_order")
    cat_map: dict[str, int] = {row[1]: row[0] for row in cur.fetchall()}
    print(f"分类映射: {cat_map}\n")

    total = 0
    skipped_empty = []

    for cat_name, cat_id in cat_map.items():
        cat_dir = SEED_DIR / cat_name
        if not cat_dir.exists() or not cat_dir.is_dir():
            continue

        images = sorted([
            f for f in cat_dir.iterdir()
            if f.is_file() and f.suffix.lower() in ALLOWED_EXT
        ])
        if not images:
            skipped_empty.append(cat_name)
            continue

        print(f"[{cat_name}] (id={cat_id}) {len(images)} 张图片")

        for img_file in images:
            ext = img_file.suffix.lower()
            filename = f"{uuid.uuid4().hex}{ext}"
            dest = UPLOADS_DIR / filename

            shutil.copy2(img_file, dest)

            relative_path = f"uploads/{filename}"
            cur.execute(
                "INSERT INTO items (category_id, image_path) VALUES (%s, %s)",
                (cat_id, relative_path),
            )
            total += 1

    conn.commit()
    cur.close()
    conn.close()

    print(f"\n{'='*40}")
    print(f"导入完成: {total} 件首饰")
    if skipped_empty:
        print(f"空目录(已跳过): {', '.join(skipped_empty)}")


if __name__ == "__main__":
    main()
