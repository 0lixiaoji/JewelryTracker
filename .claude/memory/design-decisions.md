---
name: design-decisions
description: JewelryTracker 关键设计决策——无名称、归一化、每日佩戴、无认证
metadata:
  type: project
---

## 首饰无名称字段

items 表不设 name/updated_at 字段，用户纯靠图片辨认每件首饰。图片文件用 UUID 重命名防碰撞。

## 归一化逻辑

某分类中**所有**首饰 usage_count ≥ 1 时可触发归一化：将该分类所有首饰 usage_count 减去当前最小值，使最少佩戴的首饰归零。需 MySQL 事务保证。

示例：3 个戒指 2/2/3 → 归一化 → 0/0/1。

**Why:** 避免 usage_count 无限增长，同时保留佩戴比例信息。

## 每日佩戴不覆盖

每次 POST 提交创建新 wear_record，不检查、不覆盖当天已有记录。提交后选中首饰 usage_count 自动 +1。

**Why:** 简化逻辑，每次都是新增记录。

## 单人无认证

无登录、无 JWT/Session、无用户表，所有数据属于唯一用户。
