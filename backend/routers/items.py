"""首饰路由 — CRUD + 图片上传"""

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from backend.database import get_cursor
from backend.models.schemas import ItemOut, ItemUpdate, MessageOut

router = APIRouter(prefix="/api/items", tags=["items"])

# ── 上传目录 ─────────────────────────────────────────────────────────────
UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def _validate_category(cur, category_id: int) -> None:
    """验证分类存在，否则 404"""
    cur.execute("SELECT id FROM categories WHERE id = %s", (category_id,))
    if not cur.fetchone():
        raise HTTPException(404, f"分类 {category_id} 不存在")


def _get_item_or_404(cur, item_id: int) -> dict:
    """获取首饰行，否则 404"""
    cur.execute(
        "SELECT id, category_id, image_path, usage_count, created_at "
        "FROM items WHERE id = %s",
        (item_id,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, f"首饰 {item_id} 不存在")
    return row


# ── 创建首饰（multipart）─────────────────────────────────────────────────

@router.post("", response_model=ItemOut, status_code=201)
async def create_item(
    category_id: int = Form(..., ge=1),
    image: UploadFile = File(...),
):
    """创建首饰 — 上传图片 + 选择分类，无名称字段"""
    # 验证图片格式
    if not image.filename:
        raise HTTPException(400, "未选择图片文件")
    ext = os.path.splitext(image.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"不支持的图片格式: {ext}")

    with get_cursor(commit=True) as cur:
        _validate_category(cur, category_id)

        # 生成 UUID 文件名，保留原始扩展名
        filename = f"{uuid.uuid4().hex}{ext}"
        filepath = UPLOADS_DIR / filename

        # 保存图片
        contents = await image.read()
        with open(filepath, "wb") as f:
            f.write(contents)

        relative_path = f"uploads/{filename}"
        cur.execute(
            "INSERT INTO items (category_id, image_path) VALUES (%s, %s)",
            (category_id, relative_path),
        )
        new_id = cur.lastrowid

        # 查询完整行返回
        cur.execute(
            "SELECT id, category_id, image_path, usage_count, created_at "
            "FROM items WHERE id = %s",
            (new_id,),
        )
        row = cur.fetchone()

    return ItemOut(**row)


# ── 更新首饰 ─────────────────────────────────────────────────────────────

@router.put("/{item_id}", response_model=ItemOut)
def update_item(item_id: int, body: ItemUpdate):
    """更新首饰 — 可更换分类"""
    with get_cursor(commit=True) as cur:
        _get_item_or_404(cur, item_id)

        if body.category_id is not None:
            _validate_category(cur, body.category_id)
            cur.execute(
                "UPDATE items SET category_id = %s WHERE id = %s",
                (body.category_id, item_id),
            )

        cur.execute(
            "SELECT id, category_id, image_path, usage_count, created_at "
            "FROM items WHERE id = %s",
            (item_id,),
        )
        row = cur.fetchone()

    return ItemOut(**row)


# ── 删除首饰 ─────────────────────────────────────────────────────────────

@router.delete("/{item_id}", response_model=MessageOut)
def delete_item(item_id: int):
    """删除首饰 + 图片文件"""
    with get_cursor(commit=True) as cur:
        row = _get_item_or_404(cur, item_id)
        image_path = row["image_path"]

        cur.execute("DELETE FROM items WHERE id = %s", (item_id,))

        # 删除磁盘上的图片文件
        if image_path:
            abs_path = Path(__file__).resolve().parent.parent / image_path
            if abs_path.exists():
                abs_path.unlink()

    return MessageOut(detail=f"首饰 {item_id} 已删除")
