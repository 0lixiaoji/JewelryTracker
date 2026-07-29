"""每日佩戴路由 — 记录当天佩戴的首饰"""

from fastapi import APIRouter, HTTPException

from backend.database import get_cursor
from backend.models.schemas import DailyWearCreate, ItemOut, WearRecordOut

router = APIRouter(prefix="/api/daily-wear", tags=["daily-wear"])


@router.post("", response_model=WearRecordOut, status_code=201)
def create_daily_wear(body: DailyWearCreate):
    """记录每日佩戴 — 每类最多选 1 件，提交后 usage_count 自动 +1"""

    # 1. 校验没有重复分类（每类每天最多 1 件）
    category_ids = [item.category_id for item in body.items]
    if len(category_ids) != len(set(category_ids)):
        raise HTTPException(400, "每类首饰每天最多选择 1 件")

    with get_cursor(commit=True) as cur:
        # 2. 校验每个 item 存在且分类匹配
        item_ids = [item.item_id for item in body.items]
        placeholders = ",".join(["%s"] * len(item_ids))
        cur.execute(
            f"SELECT id, category_id FROM items WHERE id IN ({placeholders})",
            item_ids,
        )
        rows = cur.fetchall()
        found = {row["id"]: row["category_id"] for row in rows}

        for item in body.items:
            if item.item_id not in found:
                raise HTTPException(404, f"首饰 {item.item_id} 不存在")
            if found[item.item_id] != item.category_id:
                raise HTTPException(
                    400,
                    f"首饰 {item.item_id} 不属于分类 {item.category_id}",
                )

        # 3. 创建佩戴记录
        cur.execute("INSERT INTO wear_records (worn_at) VALUES (CURRENT_DATE)")
        wear_record_id = cur.lastrowid

        # 4. 写入佩戴明细
        for item in body.items:
            cur.execute(
                "INSERT INTO wear_record_items (wear_record_id, item_id) VALUES (%s, %s)",
                (wear_record_id, item.item_id),
            )

        # 5. 增加每件首饰的 usage_count
        for item in body.items:
            cur.execute(
                "UPDATE items SET usage_count = usage_count + 1 WHERE id = %s",
                (item.item_id,),
            )

        # 6. 查询完整记录返回
        cur.execute(
            "SELECT id, worn_at, created_at FROM wear_records WHERE id = %s",
            (wear_record_id,),
        )
        record = cur.fetchone()

        cur.execute(
            f"SELECT id, category_id, image_path, usage_count, created_at "
            f"FROM items WHERE id IN ({placeholders})",
            item_ids,
        )
        items_rows = cur.fetchall()

    return WearRecordOut(
        id=record["id"],
        worn_at=record["worn_at"],
        created_at=record["created_at"],
        items=[ItemOut(**row) for row in items_rows],
    )
