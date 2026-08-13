import { useCallback, useState } from 'react';
import FullscreenViewer from '../components/FullscreenViewer';
import { getImageBlobUrl, isBase64 } from '../db/services/imageStore';

interface ViewerState {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** 将 image_path 解析为可渲染 URL，并读取图片自然尺寸 */
async function resolveImage(path: string): Promise<{ url: string; width: number; height: number }> {
  // 去掉缓存破坏参数（如 ?t=1234567890），获取实际文件名用于 OPFS 查找
  const opfsPath = path.includes('?') ? path.split('?')[0] : path;
  const url = isBase64(path) || path.startsWith('blob:') ? path : ((await getImageBlobUrl(opfsPath)) ?? path);
  try {
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error(`load failed: ${path}`));
      img.src = url;
    });
    return { url, ...dims };
  } catch {
    // 尺寸读取失败时仍打开查看器（fitScale 退化为 1）
    return { url, width: 0, height: 0 };
  }
}

/**
 * 点击查看原图 hook — 解析 OPFS/base64 图片，读取自然尺寸，
 * 打开全屏查看器（支持捏合缩放/拖拽/双击）。
 *
 * 用法：
 *   const { openImage, viewerEl } = useFullscreenImageViewer();
 *   <img onClick={() => openImage(item.image_path)} />
 *   {viewerEl}
 */
export default function useFullscreenImageViewer() {
  const [viewer, setViewer] = useState<ViewerState | null>(null);

  const openImage = useCallback(async (path: string, alt = '') => {
    const resolved = await resolveImage(path);
    setViewer({ src: resolved.url, alt, width: resolved.width, height: resolved.height });
  }, []);

  const close = useCallback(() => setViewer(null), []);

  const viewerEl = viewer ? (
    <FullscreenViewer
      src={viewer.src}
      alt={viewer.alt}
      imageWidth={viewer.width}
      imageHeight={viewer.height}
      open
      onClose={close}
    />
  ) : null;

  return { openImage, viewerEl };
}
