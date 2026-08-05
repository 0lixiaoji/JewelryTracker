# JewelryTracker — 首饰管家

首饰佩戴记录移动应用 — 管理 9 种首饰的日常佩戴与归一化统计。**纯前端离线架构，零后端依赖。**

## 技术栈

| 层 | 技术 |
|---|------|
| 前端框架 | React 18 + TypeScript + Vite |
| 路由 | React Router (HashRouter) |
| 状态管理 | React Context（CategoryContext + NotificationContext） |
| 本地数据库 | sql.js (SQLite WASM)，浏览器内运行 |
| 持久化 | OPFS（优先）→ IndexedDB 回退 |
| 图片存储 | OPFS 独立文件 / base64 回退 |
| 原生壳 | Capacitor 6（Android + iOS） |
| PWA | Service Worker + Web Manifest（Vercel 部署） |
| 图片裁剪 | cropperjs |
| ZIP 导出 | JSZip（流式写入 OPFS → 原生分片分享） |

## 项目结构

```
JewelryTracker/
├── CLAUDE.md                          # 项目文档（当前文件）
├── .claude/memory/                    # 持久化记忆（设计决策、工作约定）
│   ├── design-decisions.md            # 无名称、归一化、每日佩戴、无认证
│   ├── working-conventions.md         # 排查/操作/凭证/Git 准则
│   └── db-init.md                     # 旧 MySQL 初始化流程（已废弃）
├── frontend/
│   ├── package.json                   # 依赖与脚本
│   ├── capacitor.config.ts            # Capacitor 配置（appId、启动屏、状态栏）
│   ├── vite.config.ts                 # Vite 构建配置（base: './'）
│   ├── tsconfig.json
│   ├── index.html                     # 中文壳 + preloader + SW 注册
│   ├── vercel.json                    # SPA 路由重写（PWA 部署用）
│   ├── public/
│   │   ├── manifest.json              # PWA 清单（名称 首饰管家）
│   │   ├── sw.js                      # Service Worker（离线缓存）
│   │   └── sql-wasm-browser.wasm      # sql.js WASM 运行时
│   ├── resources/                     # 图标/启动屏源素材
│   ├── scripts/
│   │   ├── generate-icons.mjs         # 生成各尺寸图标
│   │   └── generate-splash.py         # 生成启动屏图片
│   ├── android/                       # Capacitor Android 原生工程
│   │   └── app/src/main/java/com/jewelrytracker/app/
│   │       ├── MainActivity.java      # Capacitor 主 Activity
│   │       └── ChunkWriter.java       # 原生 JS 桥：流式接收 base64 分片 → 写文件 → 系统分享防 OOM
│   ├── ios/                           # Capacitor iOS 原生工程
│   └── src/
│       ├── main.tsx                   # 入口：初始化 DB → 启动屏 → PWA → 渲染
│       ├── App.tsx                    # HashRouter + 6 条路由 + Layout
│       ├── api/
│       │   ├── client.ts              # API 外观层（旧 HTTP 接口签名，内部全部桥接至 db/services）
│       │   └── types.ts               # 共享类型定义
│       ├── db/
│       │   ├── database.ts            # sql.js 初始化、OPFS 持久化、防抖自动保存、每日备份、导入导出
│       │   ├── migration.ts           # SQLite 建表 + 种子数据 + 增量迁移
│       │   └── services/
│       │       ├── categories.ts      # 分类查询 + can_normalize 统计
│       │       ├── items.ts           # 首饰 CRUD（图片在 imageStore 中管理）
│       │       ├── wear.ts            # 每日佩戴记录（可修改，每类最多 1 件）
│       │       ├── normalization.ts   # 归一化逻辑（事务性减法）
│       │       ├── history.ts         # 佩戴历史分页查询
│       │       ├── imageStore.ts      # 图片文件 CRUD（OPFS 优先，base64 回退）
│       │       └── zipStream.ts       # 流式 ZIP 写入（避免内存溢出）
│       ├── capacitor/
│       │   ├── index.ts               # 原生桥接封装（相机、相册、状态栏、返回键、启动屏、分享）
│       │   └── chunkWriter.ts         # 分片写入器（JS 侧，配合 ChunkWriter.java）
│       ├── contexts/
│       │   ├── CategoryContext.tsx     # 分类列表全局状态
│       │   └── NotificationContext.tsx # 全局通知提示
│       ├── pages/
│       │   ├── Dashboard.tsx          # 首页：9 个分类卡片 + 各分类归一化按钮
│       │   ├── CategoryDetail.tsx     # 分类详情：首饰网格 + 归一化按钮
│       │   ├── ItemEditor.tsx         # 首饰编辑：图片裁剪上传 + 选择分类
│       │   ├── DailyWear.tsx          # 每日佩戴：9 类 picker，每类单选
│       │   ├── History.tsx            # 佩戴历史列表（分页）
│       │   └── DataBrowser.tsx        # 内置数据浏览：查看/导出原始数据
│       ├── components/
│       │   ├── Layout.tsx             # 全局布局 + 底部导航
│       │   ├── CompositeImage.tsx     # 组合图展示
│       │   ├── ConfirmDialog.tsx      # 确认对话框
│       │   ├── EmptyState.tsx         # 空状态占位
│       │   ├── FullscreenViewer.tsx   # 全屏图片查看
│       │   ├── ImageCropper.tsx       # 图片裁剪器
│       │   ├── ImageWithFallback.tsx  # 图片（含加载失败占位）
│       │   ├── LoadingSpinner.tsx     # 加载动画
│       │   ├── NotificationToast.tsx  # 通知提示条
│       │   └── ZoomableImage.tsx      # 可缩放图片
│       ├── hooks/
│       │   └── useSwipeBack.ts        # 滑动返回手势
│       └── utils/
│           └── fullscreenBackInterceptor.ts  # 全屏返回键拦截
```

## 数据库（5 张表，SQLite）

| 表 | 说明 |
|---|------|
| `categories` | 9 个分类（发圈/发卡/眼影/耳环/口红/项链/手链/戒指/盒子），按 sort_order 排序 |
| `items` | 每件首饰，无名称字段，纯图片辨认，图片存 OPFS/base64，image_path 为文件引用 |
| `wear_records` | 佩戴记录（worn_at 日期），每天最多一条 |
| `wear_record_items` | 佩戴明细（关联首饰），(wear_record_id, item_id) UNIQUE |
| `normalizations` | 归一化历史（category_id + min_removed + created_at） |

建表 SQL 与种子数据见 [frontend/src/db/migration.ts](frontend/src/db/migration.ts)，增量迁移通过 `MIGRATIONS` 数组管理版本号。

## 架构演变：为何不再有后端

原始架构（V1）为 React → FastAPI → MySQL，见旧版 CLAUDE.md 的 git 历史。当前 V2 架构将整个后端「下沉」到浏览器：

- **sql.js** 在 WASM 中运行完整 SQLite，替代 FastAPI + MySQL
- **OPFS**（Origin Private File System）提供持久化文件存储，替代服务器 uploads/ 目录
- **api/client.ts** 保留旧 HTTP 接口的函数签名（`fetchCategories`、`createItem`、`createDailyWear` 等），内部全部委托给 `db/services/*`，页面代码无需改动
- **图片**不再上传服务器，而是写入 OPFS 独立文件，路径引用存入 `items.image_path`

## 数据流

```
用户操作 → React 页面 → api/client.ts → db/services/* → sql.js (SQLite WASM)
                                                    ↓
                                              OPFS / IndexedDB（持久化）
```

## 持久化与备份

- **自动保存**：2 秒防抖，DB 变更后自动将整个 SQLite 序列化写入 OPFS（`visibilitychange` + `beforeunload` 兜底）
- **每日自动备份**：首次启动后每天备份一次，保留最近 5 天，存于 OPFS
- **手动导出**：DataBrowser 页面可导出 `.db` 单文件或 `.zip`（含 DB + 所有图片文件）
- **流式 ZIP**：JSZip 逐文件写入 OPFS 临时目录，避免大文件 OOM；Android 端通过 `ChunkWriter.java` 原生桥接分片分享
- **导入**：支持导入 `.db` 文件恢复数据

## 原生能力（Capacitor 插件）

| 插件 | 用途 |
|------|------|
| `@capacitor/camera` | 拍照 + 相册选取 |
| `@capacitor/filesystem` | OPFS 文件读写 |
| `@capacitor/share` | 系统分享（ZIP/DB 文件） |
| `@capacitor/splash-screen` | 启动屏（深棕 #2c2416，JS 手动隐藏） |
| `@capacitor/status-bar` | 状态栏（浅色文字，深色背景） |
| `@capacitor/app` | 返回键监听（Android 手势） |

## 页面一览（6 页）

1. **Dashboard** `/` — 9 个分类卡片，每类显示首饰数 + 归一化按钮
2. **CategoryDetail** `/categories/:id` — 首饰网格 + 分类归一化
3. **ItemEditor** `/items/new` — 图片裁剪上传 + 选择分类（无名称输入）
4. **DailyWear** `/daily-wear` — 9 类 picker，每类单选，当日可修改
5. **History** `/history` — 佩戴记录列表（分页 + 按日期分组）
6. **DataBrowser** `/data-browser` — 原始数据浏览 + 导出/导入

## npm 脚本

| 命令 | 用途 |
|------|------|
| `npm run dev` | Vite 开发服务器（host 0.0.0.0:5173） |
| `npm run build` | TypeScript 编译 + Vite 生产构建 → dist/ |
| `npm run cap:sync` | `npx cap sync` — 同步 web 资源到原生工程 |
| `npm run cap:open:android` | 打开 Android Studio |
| `npm run cap:open:ios` | 打开 Xcode |
| `npm run cap:build:android` | 构建 + 同步到 Android |
| `npm run cap:build:ios` | 构建 + 同步到 iOS |

## 关键设计约束

以下为非显而易见的设计决策，详见 memory：

- [[design-decisions]] — 首饰无名称、归一化逻辑、每日佩戴可修改、单人无认证
- [[working-conventions]] — 排查/操作/凭证/Git/Memory 管理准则
