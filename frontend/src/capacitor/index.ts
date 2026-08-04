/** Capacitor 原生能力封装
 *
 * - 仅在 Capacitor 原生环境生效，Web/PWA 模式自动降级为浏览器 API
 * - 使用方式：直接 import，内部自动判断平台
 */

import { handleBack as handleFullscreenBack } from '../utils/fullscreenBackInterceptor';

// ── 判断是否运行在 Capacitor 原生环境 ─────────────────────────────

export function isNative(): boolean {
  try {
    return !!(window as any).Capacitor?.isNative;
  } catch {
    return false;
  }
}

export function getPlatform(): 'ios' | 'android' | 'web' {
  if (!isNative()) return 'web';
  try {
    return (window as any).Capacitor?.getPlatform() ?? 'web';
  } catch {
    return 'web';
  }
}

// ── 相机拍照 ─────────────────────────────────────────────────────

/**
 * 使用原生相机拍照，返回 File 对象（与 <input type="file"> 格式兼容）。
 * Web 模式自动降级为浏览器文件选择器。
 */
export async function takePhoto(): Promise<File | null> {
  if (!isNative()) {
    // Web 降级：用隐藏的 input 选择文件
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0] ?? null;
        resolve(file);
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  // 原生环境：调用 Capacitor Camera 插件
  try {
    const { Camera, CameraResultType, CameraSource } = await import(
      '@capacitor/camera'
    );

    // 注：allowEditing 设为 false，因为 Android 上 @capacitor/camera 插件
    // 在裁剪后回调中存在 bug — 裁剪编辑器通过 EXTRA_OUTPUT 写入结果后
    // 返回 RESULT_OK 但 intent data 为 null，插件误判为"用户取消"。
    // 如需裁剪，可在 ItemEditor 页面后续接入 JS 裁剪库（如 cropperjs）。
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      quality: 90,
      allowEditing: false,
      correctOrientation: true,
      width: 1024,
      height: 1024,
      saveToGallery: true,
    });

    // 将 dataUrl 转为 File 对象（兼容现有 API）
    const res = await fetch(photo.dataUrl!);
    const blob = await res.blob();
    return new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    // 用户取消拍照
    if ((err as any)?.message?.includes?.('cancel')) return null;
    console.warn('Camera error:', err);
    return null;
  }
}

/**
 * 从相册选取图片（支持多选），返回 File 数组。
 * Web 模式自动降级为浏览器文件选择器（multiple）。
 * 原生 Android/iOS 使用 Camera.pickImages 支持多选。
 */
export async function pickFromGallery(): Promise<File[]> {
  if (!isNative()) {
    // Web 降级：隐藏的 input[multiple] 支持多选
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = () => {
        resolve(Array.from(input.files ?? []));
      };
      input.oncancel = () => resolve([]);
      input.click();
    });
  }

  // 原生环境：使用 Camera.pickImages 支持多选
  try {
    const { Camera } = await import('@capacitor/camera');

    const result = await Camera.pickImages({
      quality: 90,
      width: 1024,
      height: 1024,
    });

    const files: File[] = [];
    for (const photo of result.photos) {
      const res = await fetch(photo.webPath);
      const blob = await res.blob();
      const ext = photo.format === 'png' ? 'png' : 'jpg';
      files.push(new File([blob], `photo_${Date.now()}.${ext}`, { type: `image/${ext}` }));
    }
    return files;
  } catch (err) {
    if ((err as any)?.message?.includes?.('cancel')) return [];
    console.warn('Gallery error:', err);
    return [];
  }
}

// ── 状态栏 ───────────────────────────────────────────────────────

/**
 * 设置状态栏样式。
 * Web 模式无效果。
 */
export async function setStatusBar(style: 'light' | 'dark' = 'dark'): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: style === 'dark' ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: '#2c2416' });
  } catch {
    // 静默失败
  }
}

// ── 返回按钮 ─────────────────────────────────────────────────────

let backButtonRegistered = false;

/**
 * 注册 Android 系统返回键/手势监听（全局单例，只需调用一次）。
 *
 * - Android：系统返回键或边缘手势触发时，优先执行 SPA 路由回退
 *   （window.history.back()）；若无历史记录则退出 App
 * - iOS / Web：无效果
 *
 * 应在 App 启动后尽早调用（如 main.tsx）。
 */
export function setupBackButton(): void {
  if (!isNative() || getPlatform() !== 'android') return;
  if (backButtonRegistered) return;
  backButtonRegistered = true;

  import('@capacitor/app').then(({ App }) => {
    App.addListener('backButton', ({ canGoBack }) => {
      // 优先关闭全屏查看器，而非回退路由
      if (handleFullscreenBack()) return;

      if (canGoBack) {
        // WebView 有历史记录 → SPA 路由回退
        window.history.back();
      } else {
        // 无历史记录 → 退出 App
        App.exitApp?.();
      }
    });
  });
}

// ── 启动页 ───────────────────────────────────────────────────────

/**
 * 手动隐藏启动页（在 App 就绪后调用）。
 * Web 模式无效果。
 */
export async function hideSplashScreen(): Promise<void> {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch {
    // 静默失败
  }
}

// ── 文件导出 / 分享 ──────────────────────────────────────────────

/**
 * 将二进制数据保存为文件并通过系统分享面板导出。
 *
 * - **Capacitor 原生**：使用 Filesystem 写入临时文件，再调用 Share 弹出系统分享面板
 *   （可 AirDrop / 保存到文件 / 发送到微信等）。
 * - **Web 模式**：返回 false，由调用方走原有的 export.html 流程。
 *
 * @param data 文件二进制数据
 * @param filename 文件名（如 `jewelry-backup-2026-07-31.db`）
 * @returns true 表示已通过原生分享处理，false 表示需要走 Web 降级流程
 */
export async function nativeSaveAndShare(
  data: Uint8Array,
  filename: string,
): Promise<boolean> {
  if (!isNative()) return false;

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');

    // 将二进制数据转为 base64
    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const base64 = btoa(binary);

    // 写入临时文件
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: Directory.Cache,
    });

    // 调用系统分享面板
    await Share.share({
      title: '导出数据库',
      text: '首饰管家数据库备份',
      url: result.uri,
      dialogTitle: '分享数据库文件',
    });

    return true;
  } catch (err) {
    // 用户取消分享不算错误
    if ((err as any)?.message?.includes?.('cancel')) return true;
    console.warn('nativeSaveAndShare error:', err);
    throw err;
  }
}
