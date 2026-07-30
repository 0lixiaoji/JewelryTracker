/** Capacitor 原生能力封装
 *
 * - 仅在 Capacitor 原生环境生效，Web/PWA 模式自动降级为浏览器 API
 * - 使用方式：直接 import，内部自动判断平台
 */

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

    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera,
      quality: 90,
      allowEditing: true,
      correctOrientation: true,
      width: 1024,
      height: 1024,
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
 * 从相册选取图片，返回 File 对象。
 * Web 模式自动降级为浏览器文件选择器。
 */
export async function pickFromGallery(): Promise<File | null> {
  if (!isNative()) {
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

  try {
    const { Camera, CameraResultType, CameraSource } = await import(
      '@capacitor/camera'
    );

    const photo = await Camera.getPhoto({
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Photos,
      quality: 90,
      correctOrientation: true,
      width: 1024,
      height: 1024,
    });

    const res = await fetch(photo.dataUrl!);
    const blob = await res.blob();
    return new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    if ((err as any)?.message?.includes?.('cancel')) return null;
    console.warn('Gallery error:', err);
    return null;
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
    await StatusBar.setBackgroundColor({ color: '#fdf6f0' });
  } catch {
    // 静默失败
  }
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
