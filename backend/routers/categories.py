"""分类路由 — 固定 5 个分类，只读"""

from typing import List

from fastapi import APIRouter

from backend.database import get_cursor
from backend.models.schemas import CategoryWithStats, ItemOut

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=List[CategoryWithStats])
def list_categories():
    """列出所有分类，附带 item_count 与 can_normalize 统计"""
    with get_cursor(commit=False) as cur:
        cur.execute("""
            SELECT
                c.id,
                c.name_zh,
                c.sort_order,
                COUNT(i.id) AS item_count,
                CASE
                    WHEN COUNT(i.id) > 0
                     AND MIN(i.usage_count) >= 1 THEN TRUE
                    ELSE FALSE
                END AS can_normalize
            FROM categories c
            LEFT JOIN items i ON i.category_id = c.id
            GROUP BY c.id
            ORDER BY c.sort_order
        """)
        rows = cur.fetchall()
    return [CategoryWithStats(**row) for row in rows]


@router.get("/{category_id}/items", response_model=List[ItemOut])
def list_items(category_id: int):
    """获取某个分类下的所有首饰，按创建时间倒序"""
    with get_cursor(commit=False) as cur:
        cur.execute(
            "SELECT id, category_id, image_path, usage_count, created_at "
            "FROM items WHERE category_id = %s ORDER BY created_at DESC",
            (category_id,),
        )
        rows = cur.fetchall()
    return [ItemOut(**row) for row in rows]
