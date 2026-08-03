import { useEffect, useState } from 'react';
import { getImageBlobUrl, isBase64 } from '../db/services/imageStore';
import FullscreenViewer from './FullscreenViewer';

interface Props {
  imagePaths: string[];
  categoryName: string;
  /** imagePaths 对应的首饰 ID（顺序对应），用于判定已佩戴 */
  itemIds?: number[];
  /** 本轮已佩戴的首饰 ID 列表 */
  wornItemIds?: number[];
}

/**
 * 组合图组件 — 缩略图 + 点击全屏查看
 *
 * 缩略图：适配容器宽度，显示 "点击放大" 提示，已佩戴格子叠加红色标记。
 * 全屏：打开 FullscreenViewer，双指缩放 + 拖拽 + 双击切换。
 */
export default function CompositeImage({ imagePaths, categoryName, itemIds, wornItemIds }: Props) {
  const wornSet = new Set(wornItemIds ?? []);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (imagePaths.length === 0) { setError(true); return; }

    let cancelled = false;

    async function generate() {
      try {
        // 加载图片 + 对应 ID（失败则跳过）
        const entries: { img: HTMLImageElement; id: number }[] = [];
        for (let i = 0; i < imagePaths.length; i++) {
          if (cancelled) return;
          const path = imagePaths[i];
          let src: string;
          if (isBase64(path)) {
            src = path;
          } else {
            const blobUrl = await getImageBlobUrl(path);
            if (!blobUrl) continue;
            src = blobUrl;
          }
          try {
            entries.push({
              img: await loadImage(src),
              id: itemIds?.[i] ?? i,
            });
          } catch { /* skip */ }
        }

        if (cancelled) return;
        if (entries.length === 0) { setError(true); return; }

        const count = entries.length;
        const cellSize = 280;
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        const cw = cols * cellSize;
        const ch = rows * cellSize;

        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, 0, cw, ch);

        const gap = 4;
        for (let i = 0; i < entries.length; i++) {
          if (cancelled) return;
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = col * cellSize + gap;
          const y = row * cellSize + gap;
          const w = cellSize - gap * 2;
          const h = cellSize - gap * 2;

          const { img, id } = entries[i];
          const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
          const dw = img.naturalWidth * scale;
          const dh = img.naturalHeight * scale;

          ctx.fillStyle = '#fafafa';
          ctx.fillRect(x, y, w, h);
          ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);

          // 已佩戴标记：红色半透明遮罩 + 文字
          if (wornSet.has(id)) {
            // 底部红色条
            const barH = Math.max(20, h * 0.18);
            ctx.fillStyle = 'rgba(211, 47, 47, 0.78)';
            ctx.fillRect(x, y + h - barH, w, barH);
            // 文字
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(12, barH * 0.6)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('已佩戴', x + w / 2, y + h - barH / 2);
          }
        }

        const url = canvas.toDataURL('image/jpeg', 0.85);
        if (!cancelled) {
          setDataUrl(url);
          setImageSize({ w: cw, h: ch });
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    generate();
    return () => { cancelled = true; };
  }, [imagePaths, itemIds, wornItemIds]);

  if (error) {
    return (
      <div className="composite-fallback">{categoryName} 暂无图片</div>
    );
  }

  if (!dataUrl) {
    return <div className="composite-loading" />;
  }

  return (
    <>
      <div className="composite-thumb" onClick={() => setFullscreen(true)}>
        <img
          src={dataUrl}
          alt={`${categoryName}组合图`}
          onError={(e) => {
            // data URL 加载失败时降级显示文字
            (e.target as HTMLImageElement).style.display = 'none';
            setError(true);
          }}
        />
        <span className="composite-hint">点击放大</span>
      </div>

      <FullscreenViewer
        src={dataUrl}
        alt={`${categoryName}组合图`}
        imageWidth={imageSize.w}
        imageHeight={imageSize.h}
        open={fullscreen}
        onClose={() => setFullscreen(false)}
      />
    </>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`load failed`));
    img.src = src;
  });
}
