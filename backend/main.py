"""JewelryTracker FastAPI 入口"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.database import get_cursor
from backend.routers import categories, daily_wear, history, items, normalization

# ── 应用实例 ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="JewelryTracker API",
    version="0.1.0",
)

# ── CORS（开发阶段允许所有来源）──────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 静态文件（上传的首饰图片）────────────────────────────────────────────
uploads_dir = Path(__file__).resolve().parent / "uploads"
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# ── 静态文件（种子图片）───────────────────────────────────────────────────
seed_dir = Path(__file__).resolve().parent.parent / "database" / "seed-images" / "items"
app.mount(
    "/database/seed-images/items",
    StaticFiles(directory=str(seed_dir)),
    name="seed-images",
)

# ── 路由注册 ─────────────────────────────────────────────────────────────
app.include_router(categories.router)
app.include_router(items.router)
app.include_router(daily_wear.router)
app.include_router(normalization.router)
app.include_router(history.router)

# ── 健康检查 ─────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health_check():
    try:
        with get_cursor(commit=False) as cur:
            cur.execute("SELECT 1")
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"

    return {
        "status": "ok",
        "database": db_status,
    }
