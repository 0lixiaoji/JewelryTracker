"""Pydantic 数据模型 — 对应 5 张数据库表 + 请求/响应 schema"""

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ── 分类 ─────────────────────────────────────────────────────────────────

class CategoryOut(BaseModel):
    id: int
    name_zh: str
    sort_order: int


class CategoryWithStats(CategoryOut):
    """分类列表响应，附带归一化条件统计"""
    item_count: int = 0
    can_normalize: bool = False  # 所有首饰 usage_count >= 1 且 > 0 件


# ── 首饰 ─────────────────────────────────────────────────────────────────

class ItemOut(BaseModel):
    id: int
    category_id: int
    image_path: Optional[str] = None
    usage_count: int = 0
    created_at: datetime


class ItemCreate(BaseModel):
    """创建首饰 — image 通过 multipart 单独上传"""
    category_id: int = Field(ge=1)


class ItemUpdate(BaseModel):
    """更新首饰 — 可更换分类"""
    category_id: Optional[int] = Field(default=None, ge=1)


# ── 每日佩戴 ─────────────────────────────────────────────────────────────

class DailyWearItem(BaseModel):
    """单类选择：每类最多 1 件"""
    category_id: int
    item_id: int


class DailyWearCreate(BaseModel):
    """每日佩戴请求"""
    items: List[DailyWearItem] = Field(min_length=1, max_length=5)


# ── 佩戴记录 ─────────────────────────────────────────────────────────────

class WearRecordItemOut(BaseModel):
    id: int
    wear_record_id: int
    item_id: int


class WearRecordOut(BaseModel):
    id: int
    worn_at: date
    created_at: datetime
    items: List[ItemOut] = []


# ── 归一化 ───────────────────────────────────────────────────────────────

class NormalizationOut(BaseModel):
    id: int
    category_id: int
    min_removed: int
    created_at: datetime


# ── 历史分页 ─────────────────────────────────────────────────────────────

class HistoryPage(BaseModel):
    items: List[WearRecordOut]
    total: int
    page: int
    page_size: int


# ── 通用响应 ─────────────────────────────────────────────────────────────

class MessageOut(BaseModel):
    detail: str
