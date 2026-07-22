# JewelryTracker

首饰佩戴记录全栈项目 — 管理发圈、耳钉、项链、手镯、戒指 5 种首饰的日常佩戴与归一化统计。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React + TypeScript + Vite + React Router |
| 后端 | Python + FastAPI + PyMySQL |
| 数据库 | MySQL |
| 状态管理 | React Context（CategoryContext + NotificationContext） |
| HTTP | 原生 fetch（不用 axios） |
| 图片上传 | FastAPI UploadFile + python-multipart |

## 项目结构（规划）

```
JewelryTracker/
├── CLAUDE.md
├── database/migration.sql          # 建表迁移脚本
├── backend/
│   ├── main.py                     # FastAPI 入口
│   ├── database.py                 # DB 连接池
│   ├── models/                     # Pydantic schemas
│   ├── routers/                    # API 路由
│   └── uploads/                    # 图片存储目录
├── frontend/
│   ├── src/
│   │   ├── api/                    # API client
│   │   ├── contexts/               # React Context
│   │   ├── pages/                  # 5 个页面
│   │   └── components/             # 共享组件
│   └── vite.config.ts             # Vite 代理配置
```

## 数据库（5 张表）

- **categories** — 固定 5 个分类（发圈/耳钉/项链/手镯/戒指），按 sort_order 排序
- **items** — 每件首饰，无名称字段，纯图片辨认，无 updated_at
- **wear_records** — 佩戴记录（worn_at 日期）
- **wear_record_items** — 佩戴明细（关联首饰）
- **normalizations** — 归一化历史（category_id + min_removed）

迁移脚本位于 [database/migration.sql](database/migration.sql)。

## API 端点（8 个）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/categories` | 分类列表 + can_normalize 统计 |
| GET | `/api/categories/{id}/items` | 分类下所有首饰 |
| POST | `/api/items` | 创建首饰（multipart，含图片） |
| PUT | `/api/items/{id}` | 更新首饰 |
| DELETE | `/api/items/{id}` | 删除首饰 + 图片文件 |
| POST | `/api/daily-wear` | 记录佩戴（每类最多 1 件） |
| POST | `/api/categories/{id}/normalize` | 归一化 |
| GET | `/api/history` | 佩戴历史（分页） |

Vite 代理 `/api`、`/uploads` 到 FastAPI 后端（uvicorn port 8000）。

## 前端页面（5 页）

1. **Dashboard** — 5 个分类卡片，归一化按钮
2. **CategoryDetail** — 首饰网格，归一化按钮
3. **ItemEditor** — 图片上传预览 + 选择分类（无名称字段）
4. **DailyWear** — 5 类 picker，每类单选
5. **History** — 佩戴记录列表（分页）

## 实施顺序

1. 项目脚手架 + 数据库建表（migration.sql 已生成）
2. FastAPI 骨架 + DB 连接 + Pydantic schemas
3. Categories/Items CRUD + 图片上传
4. DailyWear + Normalization + History
5. Vite 脚手架 + 路由 + 布局 + API client
6. 5 个页面 + 共享组件
7. 联调测试

## 关键设计约束

以下为非显而易见的设计决策，详见 memory：
- [[design-decisions]] — 首饰无名称、归一化逻辑、每日佩戴不覆盖、单人无认证
