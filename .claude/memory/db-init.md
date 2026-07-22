---
name: db-init
description: 连接数据库并执行 migration.sql 建表的完整工作流
metadata:
  type: project
---

## 数据库初始化工作流

当用户要求连接数据库或执行 migration.sql 建表时，按以下步骤执行。

### 环境变量

连接信息来自 `.mcp.json` 中 database server 配置的 `DATABASE_URL` 环境变量（格式 `mysql://user:pass@host:port/db`）。不要硬编码实际值——每次都从环境变量解析。

### 步骤

1. **检查环境变量** — 用 `-z` 判空即可，禁止 echo 值（[[working-conventions]]）

2. **解析 URL** — 密码可能含 `@`，必须用右侧优先拆分：
   ```bash
   without_prefix="${url#mysql://}"
   hostportdb="${without_prefix##*@}"       # 从右取 host:port/db
   userpass="${without_prefix%@*}"          # 剩下的就是 user:pass
   user="${userpass%%:*}"
   pass="${userpass#*:}"
   [ "$pass" = "$user" ] && pass=""         # 无冒号则无密码
   host="${hostportdb%%:*}"
   port="${hostportdb#*:}"; port="${port%%/*}"
   db="${hostportdb#*/}"
   ```

3. **MCP 连接** — 用解析出的参数调用 `mcp__database__connect`

4. **健康检查** — `mcp__database__health_check` 验证延迟、版本、运行时间

5. **检查现有表** — `mcp__database__list_tables`，避免重复建表

6. **建表** — 按 migration.sql 顺序执行。优先用 MCP `create_table`/`alter_table`；遇到以下限制时改用 Python + PyMySQL 兜底：
   - `alter_table` 不支持 `ADD CONSTRAINT ... FOREIGN KEY` 语法
   - `create_table` 对 `DEFAULT (CURRENT_DATE)` 等函数表达式默认值解析失败
   - MCP 工具报 SQL 语法错误且确认不是拼写问题时

   ```python
   import pymysql
   conn = pymysql.connect(host=h, port=p, user=u, password=pw, database=db)
   cur = conn.cursor()
   cur.execute('''DDL STATEMENT HERE''')
   conn.commit()
   ```

7. **验证 Schema** — `mcp__database__inspect_schema` 对比 migration.sql 确认表数量、列定义、索引、外键全部到位

8. **验证种子数据** — `SELECT * FROM categories ORDER BY sort_order` 确认分类数据已插入

9. **汇报** — 结构化表格列出表名、行数、关键约束状态

### 踩坑记录

- **密码含特殊字符**：`sed` 的 `[^@]+` 无法区分密码中的 `@` 和 `user:pass@host` 分隔符。用 `${var##*@}` 从右侧拆分。
- **MCP DDL 限制**：`execute` 只接受 INSERT/UPDATE/DELETE；`alter_table` 不支持 FK 约束；`create_table` 对函数表达式默认值解析失败。统一用 Python + PyMySQL 兜底。
- **无 mysql CLI**：Windows Git Bash 环境通常没有 `mysql` 命令行，Python 是可靠替代。

**Why:** 一键初始化数据库表结构，记录了 MCP 工具的 DDL 限制及对应兜底方案。
**How to apply:** 用户说"连接数据库"、"执行 migration"、"建表"或类似表述时触发。
