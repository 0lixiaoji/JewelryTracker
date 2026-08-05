package com.jewelrytracker.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import android.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 分片文件写入器 — 供 JavaScript 层分批写入大文件到 Cache 目录。
 *
 * JS 端通过 window.NativeChunkWriter 调用，
 * 每个文件依次 create → 多次 write → finishAndShare，
 * 完成后由原生层直接弹出系统分享面板，全程 JS 内存只保留当前分片（1MB）。
 */
public class ChunkWriter {

    private final Context context;
    private final Map<String, FileOutputStream> streams = new ConcurrentHashMap<>();
    private final Map<String, String> filePaths = new ConcurrentHashMap<>();

    public ChunkWriter(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public void create(String filename) {
        try {
            File file = new File(context.getCacheDir(), filename);
            filePaths.put(filename, file.getAbsolutePath());
            streams.put(filename, new FileOutputStream(file));
        } catch (Exception e) {
            // 创建失败，后续 write/finish 将无操作
        }
    }

    @JavascriptInterface
    public void write(String filename, String base64Chunk) {
        try {
            FileOutputStream stream = streams.get(filename);
            if (stream != null && base64Chunk != null && !base64Chunk.isEmpty()) {
                byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
                stream.write(bytes);
            }
        } catch (Exception e) {
            // 写入失败，忽略此分片
        }
    }

    /**
     * 关闭文件流并弹出系统分享面板。
     *
     * 调用后文件即被关闭，后续无法再 write。
     * 分享通过 Capacitor 已配置的 FileProvider 生成 content URI。
     *
     * @param filename 文件名
     * @param mimeType MIME 类型（如 application/zip）
     * @param title    分享对话框标题
     */
    @JavascriptInterface
    public void finishAndShare(String filename, String mimeType, String title) {
        // 1. 关闭文件流
        FileOutputStream stream = streams.remove(filename);
        if (stream != null) {
            try { stream.close(); } catch (Exception ignored) {}
        }

        String filePath = filePaths.remove(filename);
        if (filePath == null) return;

        // 2. 通过 FileProvider 生成 content URI
        File file = new File(filePath);
        if (!file.exists() || file.length() == 0) return;

        Uri contentUri;
        try {
            contentUri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                file
            );
        } catch (Exception e) {
            return;
        }

        // 3. 构建分享 Intent 并弹出系统分享面板
        Intent shareIntent = new Intent(Intent.ACTION_SEND);
        shareIntent.setType(mimeType);
        shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
        shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        Intent chooser = Intent.createChooser(shareIntent, title);
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            context.startActivity(chooser);
        } catch (Exception e) {
            // 没有可处理的应用
        }
    }
}
