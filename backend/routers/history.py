"""历史路由 — 佩戴记录分页查询"""

from fastapi import APIRouter, Query

from backend.database import get_cursor
from backend.models.schemas import HistoryPage, ItemOut, WearRecordOut

router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("", response_model=HistoryPage)
def list_history(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    """分页获取佩戴历史，按日期倒序"""
    with get_cursor(commit=False) as cur:
        # 1. 总数
        cur.execute("SELECT COUNT(*) AS total FROM wear_records")
        total = cur.fetchone()["total"]

        # 2. 分页查询佩戴记录
        offset = (page - 1) * page_size
        cur.execute(
            "SELECT id, worn_at, created_at FROM wear_records "
            "ORDER BY worn_at DESC, created_at DESC "
            "LIMIT %s OFFSET %s",
            (page_size, offset),
        )
        records = cur.fetchall()

        if not records:
            return HistoryPage(items=[], total=total, page=page, page_size=page_size)

        # 3. 批量查询所有记录的首饰明细
        record_ids = [r["id"] for r in records]
        placeholders = ",".join(["%s"] * len(record_ids))
        cur.execute(
            f"SELECT wri.wear_record_id, wri.item_id, wri.id AS wri_id, "
            f"i.id, i.category_id, i.image_path, i.usage_count, i.created_at "
            f"FROM wear_record_items wri "
            f"JOIN items i ON i.id = wri.item_id "
            f"WHERE wri.wear_record_id IN ({placeholders})",
            record_ids,
        )
        item_rows = cur.fetchall()

        # 4. 按 wear_record_id 分组
        items_map: dict[int, list[ItemOut]] = {}
        for row in item_rows:
            record_id = row["wear_record_id"]
            if record_id not in items_map:
                items_map[record_id] = []
            items_map[record_id].append(
                ItemOut(
                    id=row["id"],
                    category_id=row["category_id"],
                    image_path=row["image_path"],
                    usage_count=row["usage_count"],
                    created_at=row["created_at"],
                )
            )

        # 5. 组装响应
        result = [
            WearRecordOut(
                id=r["id"],
                worn_at=r["worn_at"],
                created_at=r["created_at"],
                items=items_map.get(r["id"], []),
            )
            for r in records
        ]

    return HistoryPage(items=result, total=total, page=page, page_size=page_size)
