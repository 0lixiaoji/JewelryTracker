"""PyMySQL 连接池 — 单用户应用，每个请求获取/归还连接"""

import os
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor


# ── 连接配置（从环境变量读取）────────────────────────────────────────────
DB_CONFIG = {
    "host": os.getenv("MYSQL_HOST", os.getenv("DB_HOST", "127.0.0.1")),
    "port": int(os.getenv("MYSQL_PORT", os.getenv("DB_PORT", "3306"))),
    "user": os.getenv("MYSQL_USER", os.getenv("DB_USER", "root")),
    "password": os.getenv("MYSQL_PASSWORD", os.getenv("DB_PASSWORD", "")),
    "database": os.getenv("MYSQL_DATABASE", os.getenv("DB_NAME", "jewelry_tracker")),
    "charset": "utf8mb4",
    "cursorclass": DictCursor,
}


def get_connection() -> pymysql.Connection:
    """获取一个新的数据库连接"""
    return pymysql.connect(**DB_CONFIG)


@contextmanager
def get_cursor(commit: bool = True):
    """获取数据库游标的上下文管理器，退出时自动关闭连接。

    用法:
        with get_cursor() as cur:
            cur.execute("SELECT ...")
            rows = cur.fetchall()

        with get_cursor(commit=True) as cur:
            cur.execute("INSERT ...")
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        yield cur
        if commit:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()
