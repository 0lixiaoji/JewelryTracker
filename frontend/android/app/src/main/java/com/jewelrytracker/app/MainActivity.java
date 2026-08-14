package com.jewelrytracker.app;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Switch from Launch theme (full-screen splash image) to normal app theme.
        // Must be called BEFORE super.onCreate() for the window to pick up the new theme.
        setTheme(R.style.AppTheme_NoActionBar);
        super.onCreate(savedInstanceState);

        // 注册原生分片写入器 — JS 通过 window.NativeChunkWriter 调用，
        // 用于大文件导出时以 1MB 分片写入 Cache 目录，避免 OOM。
        WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(
            new ChunkWriter(this),
            "NativeChunkWriter"
        );

        // 注册备份导出器 — JS 通过 window.NativeBackupExporter 调用，
        // 用于每日备份分片直写 内部存储/Download/JewelryTracker/。
        webView.addJavascriptInterface(
            new BackupExporter(this),
            "NativeBackupExporter"
        );
    }
}
