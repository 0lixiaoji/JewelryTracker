"""归一化路由 — 将某分类所有首饰的 usage_count 等比例缩减"""

from fastapi import APIRouter, HTTPException

from backend.database import get_cursor
from backend.models.schemas import NormalizationOut

router = APIRouter(prefix="/api/categories", tags=["normalization"])


@router.post("/{category_id}/normalize", response_model=NormalizationOut)
def normalize_category(category_id: int):
    """归一化：将该分类所有首饰 usage_count 减去当前最小值（需全部 ≥ 1）"""
    with get_cursor(commit=True) as cur:
        # 1. 验证分类存在
        cur.execute("SELECT id FROM categories WHERE id = %s", (category_id,))
        if not cur.fetchone():
            raise HTTPException(404, f"分类 {category_id} 不存在")

        # 2. 获取 usage_count 最小值 + 验证归一化条件
        cur.execute(
            "SELECT MIN(usage_count) AS min_usage, COUNT(*) AS cnt "
            "FROM items WHERE category_id = %s",
            (category_id,),
        )
        stats = cur.fetchone()

        if stats["cnt"] == 0:
            raise HTTPException(400, "该分类下没有首饰，无法归一化")
        if stats["min_usage"] < 1:
            raise HTTPException(400, "存在未佩戴过的首饰，无法归一化")

        min_removed = stats["min_usage"]

        # 3. 所有首饰减去最小值
        cur.execute(
            "UPDATE items SET usage_count = usage_count - %s "
            "WHERE category_id = %s",
            (min_removed, category_id),
        )

        # 4. 记录归一化历史
        cur.execute(
            "INSERT INTO normalizations (category_id, min_removed) VALUES (%s, %s)",
            (category_id, min_removed),
        )
        norm_id = cur.lastrowid

        cur.execute(
            "SELECT id, category_id, min_removed, created_at "
            "FROM normalizations WHERE id = %s",
            (norm_id,),
        )
        row = cur.fetchone()

    return NormalizationOut(**row)
