-- JewelryTracker 数据库迁移脚本
-- 运行方式: mysql -u root -p < migration.sql

CREATE DATABASE IF NOT EXISTS jewelry_tracker
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE jewelry_tracker;

-- 1. 分类表（固定 5 个分类）
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name_zh VARCHAR(50) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

INSERT INTO categories (name_zh, sort_order) VALUES
    ('发圈', 1),
    ('耳钉', 2),
    ('项链', 3),
    ('手镯', 4),
    ('戒指', 5);

-- 2. 首饰表（纯图片辨认，无名称）
CREATE TABLE IF NOT EXISTS items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    image_path VARCHAR(500) DEFAULT NULL,
    usage_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
    INDEX idx_category (category_id)
) ENGINE=InnoDB;

-- 3. 佩戴记录表
CREATE TABLE IF NOT EXISTS wear_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    worn_at DATE NOT NULL DEFAULT (CURRENT_DATE),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_worn_at (worn_at)
) ENGINE=InnoDB;

-- 4. 佩戴明细表（关联首饰）
CREATE TABLE IF NOT EXISTS wear_record_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    wear_record_id INT NOT NULL,
    item_id INT NOT NULL,
    FOREIGN KEY (wear_record_id) REFERENCES wear_records(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
    UNIQUE INDEX uk_wear_item (wear_record_id, item_id)
) ENGINE=InnoDB;

-- 5. 归一化历史表
CREATE TABLE IF NOT EXISTS normalizations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    category_id INT NOT NULL,
    min_removed INT UNSIGNED NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB;
