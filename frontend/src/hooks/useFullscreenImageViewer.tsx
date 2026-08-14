import { useCallback, useRef, useState } from 'react';
import FullscreenViewer from '../components/FullscreenViewer';
import { getImageBlobUrl, isBase64 } from '../db/services/imageStore';

interface ResolvedImage {
  url: string;
  width: number;
  height: number;
}

/** 将 image_path 解析为可渲染 URL，并读取图片自然尺寸 */
async function resolveImage(path: string): Promise<ResolvedImage> {
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
 * 打开全屏查看器（支持捏合缩放/拖拽/双击，可选左右滑动切换上一张/下一张）。
 *
 * 用法：
 *   const { openImage, openGallery, viewerEl } = useFullscreenImageViewer();
 *   <img onClick={() => openImage(item.image_path)} />
 *   // 多图左右滑动：
 *   <img onClick={() => openGallery(paths, index)} />
 *   {viewerEl}
 */
export default function useFullscreenImageViewer() {
  const [viewer, setViewer] = useState<ResolvedImage | null>(null);
  const [gallery, setGallery] = useState<{ paths: string[]; index: number } | null>(null);
  const cacheRef = useRef(new Map<string, ResolvedImage>());
  const cache = cacheRef.current;
  // 记录最近一次请求展示的图片路径，丢弃过期的异步解析结果
  const latestPathRef = useRef<string | null>(null);

  /** 解析并展示某张图；若在 gallery 中则同步更新当前索引 */
  const showImage = useCallback(
    (path: string, index: number | null, paths: string[]) => {
      latestPathRef.current = path;
      const apply = (res: ResolvedImage) => {
        // 快速左右滑动时，前一张的异步解析可能晚于当前张返回，
        // 若此时展示的已是最新请求的图，则丢弃过期结果避免覆盖。
        if (latestPathRef.current !== path) return;
        setViewer(res);
        if (index !== null) setGallery({ paths, index });
      };
      const cached = cache.get(path);
      if (cached) {
        apply(cached);
      } else {
        resolveImage(path).then((res) => {
          cache.set(path, res);
          apply(res);
        });
      }
    },
    [cache],
  );

  /** 打开单张图（无左右滑动） */
  const openImage = useCallback(
    (path: string) => {
      setGallery(null);
      showImage(path, null, [path]);
    },
    [showImage],
  );

  /** 打开多图浏览，支持左右滑动切换；startIndex 为初始显示的图片下标 */
  const openGallery = useCallback(
    (paths: string[], startIndex: number) => {
      if (paths.length === 0) return;
      const idx = Math.max(0, Math.min(startIndex, paths.length - 1));
      // 立即解析并打开当前图
      showImage(paths[idx], idx, paths);
      // 后台预解析其余图片（缓存自然尺寸，切换时即时展示）
      for (let i = 0; i < paths.length; i++) {
        if (i === idx || cache.has(paths[i])) continue;
        const p = paths[i];
        resolveImage(p).then((res) => cache.set(p, res));
      }
    },
    [showImage, cache],
  );

  const close = useCallback(() => {
    latestPathRef.current = null; // 关闭后过期的解析结果不再生效
    setViewer(null);
    setGallery(null);
  }, []);

  /** 切换到第 index 张 */
  const goTo = useCallback(
    (index: number) => {
      if (!gallery) return;
      const clamped = Math.max(0, Math.min(index, gallery.paths.length - 1));
      if (clamped === gallery.index) return;
      showImage(gallery.paths[clamped], clamped, gallery.paths);
    },
    [gallery, showImage],
  );

  const viewerEl = viewer ? (
    <FullscreenViewer
      src={viewer.url}
      alt=""
      imageWidth={viewer.width}
      imageHeight={viewer.height}
      open
      onClose={close}
      total={gallery ? gallery.paths.length : 1}
      index={gallery ? gallery.index + 1 : 1}
      onSwipeLeft={
        gallery && gallery.index < gallery.paths.length - 1
          ? () => goTo(gallery.index + 1) // 左滑 → 下一张
          : undefined
      }
      onSwipeRight={
        gallery && gallery.index > 0
          ? () => goTo(gallery.index - 1) // 右滑 → 上一张
          : undefined
      }
    />
  ) : null;

  return { openImage, openGallery, viewerEl };
}
