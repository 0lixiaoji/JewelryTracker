package com.jewelrytracker.app;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 备份导出器 — 供 JavaScript 层分片写入每日备份 zip 到 内部存储/Download/JewelryTracker/。
 *
 * 通过 MediaStore Downloads 写入公共 Download 目录（无需存储权限），
 * 文件管理器 / 电脑 USB 直接可见。
 * 每个文件依次 create → 多次 write → finish（IS_PENDING=1 建文件，finish 后 IS_PENDING=0 可见）。
 *
 * 需 API 29+（MediaStore.Downloads）；更低版本 isAvailable() 返回 false，由 JS 侧跳过。
 */
public class BackupExporter {

    private static final String BACKUP_RELATIVE_PATH = "Download/JewelryTracker";
    private static final String BACKUP_PREFIX = "jewelry-backup-";

    private final Context context;
    private final Map<String, OutputStream> streams = new ConcurrentHashMap<>();
    private final Map<String, Uri> uris = new ConcurrentHashMap<>();

    public BackupExporter(Context context) {
        this.context = context.getApplicationContext();
    }

    /** MediaStore.Downloads 需要 API 29+ */
    @JavascriptInterface
    public boolean isAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
    }

    /** 在 Download/JewelryTracker 下创建备份文件（暂不可见），打开输出流。 */
    @JavascriptInterface
    public boolean create(String filename) {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
            values.put(MediaStore.Downloads.MIME_TYPE, "application/zip");
            values.put(MediaStore.Downloads.RELATIVE_PATH, BACKUP_RELATIVE_PATH);
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            ContentResolver resolver = context.getContentResolver();
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return false;

            OutputStream os = resolver.openOutputStream(uri);
            if (os == null) return false;

            streams.put(filename, os);
            uris.put(filename, uri);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 追加写入一个 base64 分片。 */
    @JavascriptInterface
    public void write(String filename, String base64Chunk) {
        try {
            OutputStream stream = streams.get(filename);
            if (stream != null && base64Chunk != null && !base64Chunk.isEmpty()) {
                stream.write(Base64.decode(base64Chunk, Base64.DEFAULT));
            }
        } catch (Exception e) {
            // 写入失败，忽略此分片（最终由 JS 端 delete 清理半成品）
        }
    }

    /** 关闭流并标记文件完成（对用户可见）。 */
    @JavascriptInterface
    public boolean finish(String filename) {
        OutputStream stream = streams.remove(filename);
        if (stream != null) {
            try { stream.close(); } catch (Exception ignored) {}
        }
        Uri uri = uris.remove(filename);
        if (uri == null) return false;

        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        try {
            context.getContentResolver().update(uri, values, null, null);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 删除指定备份文件。 */
    @JavascriptInterface
    public boolean delete(String filename) {
        try {
            Uri uri = findUri(filename);
            if (uri == null) return false;
            return context.getContentResolver().delete(uri, null, null) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** 列出 Download/JewelryTracker 下的备份文件名（按名称升序）。 */
    @JavascriptInterface
    public String[] list() {
        ArrayList<String> names = new ArrayList<>();
        try {
            ContentResolver resolver = context.getContentResolver();
            String selection = MediaStore.Downloads.RELATIVE_PATH + " LIKE ?";
            String[] args = new String[] { BACKUP_RELATIVE_PATH + "/%" };
            String[] projection = new String[] { MediaStore.Downloads.DISPLAY_NAME };

            try (Cursor cursor = resolver.query(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, projection, selection, args,
                    MediaStore.Downloads.DISPLAY_NAME + " ASC")) {
                if (cursor != null) {
                    int col = cursor.getColumnIndexOrThrow(MediaStore.Downloads.DISPLAY_NAME);
                    while (cursor.moveToNext()) {
                        String name = cursor.getString(col);
                        if (name != null && name.startsWith(BACKUP_PREFIX)) {
                            names.add(name);
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return names.toArray(new String[0]);
    }

    /** 删除文件名日期早于 cutoffDateStr（YYYY-MM-DD）的旧备份。 */
    @JavascriptInterface
    public void cleanup(String cutoffDateStr) {
        try {
            for (String name : list()) {
                String dateStr = name
                    .replace(BACKUP_PREFIX, "")
                    .replace(".zip", "")
                    .replace(".db", "");
                if (dateStr.length() == 10 && dateStr.compareTo(cutoffDateStr) < 0) {
                    delete(name);
                }
            }
        } catch (Exception ignored) {}
    }

    private Uri findUri(String filename) {
        try {
            ContentResolver resolver = context.getContentResolver();
            String selection = MediaStore.Downloads.DISPLAY_NAME + " = ? AND "
                + MediaStore.Downloads.RELATIVE_PATH + " LIKE ?";
            String[] args = new String[] { filename, BACKUP_RELATIVE_PATH + "/%" };
            String[] projection = new String[] { MediaStore.Downloads._ID };

            try (Cursor cursor = resolver.query(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, projection, selection, args, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    long id = cursor.getLong(cursor.getColumnIndexOrThrow(MediaStore.Downloads._ID));
                    return ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, id);
                }
            }
        } catch (Exception ignored) {}
        return null;
    }
}
