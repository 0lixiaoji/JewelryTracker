import { useCallback, useEffect, useRef, useState } from 'react';
import { getImageBlobUrl, isBase64 } from '../db/services/imageStore';
import FullscreenViewer from './FullscreenViewer';

interface CellRect {
  id: number;
  x: number; // canvas 坐标系
  y: number;
  w: number;
  h: number;
}

interface Props {
  imagePaths: string[];
  categoryName: string;
  /** imagePaths 对应的首饰 ID（顺序对应），用于判定已佩戴 */
  itemIds?: number[];
  /** 本轮已佩戴的首饰 ID 列表 */
  wornItemIds?: number[];
  /** 当前选中的 item ID（null = 不戴） */
  selectedItemId?: number | null;
  /** 格子点击回调 */
  onCellClick?: (itemId: number) => void;
}

/**
 * 组合图组件 — 可点击格子选中 + 全屏查看
 *
 * 单击格子 = 选中/取消首饰
 * 双击 = 打开全屏查看（双指缩放 + 拖拽）
 * 已佩戴格子叠加灰色蒙层 + 红色标记
 * 选中格子叠加蓝色边框覆盖层（CSS，无需重绘 canvas）
 */
export default function CompositeImage({
  imagePaths,
  categoryName,
  itemIds,
  wornItemIds,
  selectedItemId,
  onCellClick,
}: Props) {
  const wornSet = new Set(wornItemIds ?? []);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [fullscreen, setFullscreen] = useState(false);

  // 格子坐标（canvas 坐标系），点击命中 + 覆盖层定位用
  const cellsRef = useRef<CellRect[]>([]);
  const colsRef = useRef(0);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // 选中覆盖层样式（相对于 composite-thumb 容器）
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties | null>(null);

  const CELL_SIZE = 280;
  const GAP = 4;

  useEffect(() => {
    if (imagePaths.length === 0) { setError(true); return; }

    let cancelled = false;
    let revokeUrl: string | null = null;

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
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        const cw = cols * CELL_SIZE;
        const ch = rows * CELL_SIZE;

        colsRef.current = cols;
        cellsRef.current = []; // 重建

        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, 0, cw, ch);

        for (let i = 0; i < entries.length; i++) {
          if (cancelled) return;
          const col = i % cols;
          const row = Math.floor(i / cols);
          const x = col * CELL_SIZE + GAP;
          const y = row * CELL_SIZE + GAP;
          const w = CELL_SIZE - GAP * 2;
          const h = CELL_SIZE - GAP * 2;

          const { img, id } = entries[i];

          // 记录格子坐标
          cellsRef.current.push({ id, x, y, w, h });

          const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
          const dw = img.naturalWidth * scale;
          const dh = img.naturalHeight * scale;

          ctx.fillStyle = '#fafafa';
          ctx.fillRect(x, y, w, h);
          ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);

          // 已佩戴标记：灰色蒙层 + 底部文字条
          if (wornSet.has(id)) {
            // 整格灰色覆盖，降低亮度区分已佩戴
            ctx.fillStyle = 'rgba(160, 160, 160, 0.6)';
            ctx.fillRect(x, y, w, h);
            // 底部红色条 + 文字
            const barH = Math.max(20, h * 0.18);
            ctx.fillStyle = 'rgba(211, 47, 47, 0.78)';
            ctx.fillRect(x, y + h - barH, w, barH);
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(12, barH * 0.6)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('已佩戴', x + w / 2, y + h - barH / 2);
          }
        }

        // 优先 toBlob（轻量），失败则回退 toDataURL
        let url: string | null = null;
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
        );
        if (blob) {
          url = URL.createObjectURL(blob);
        } else {
          // toBlob 回调返回 null（部分旧 WebView）→ 回退
          try {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            if (dataUrl && dataUrl.length > 100) url = dataUrl;
          } catch { /* ignore */ }
        }

        if (!cancelled && url) {
          revokeUrl = url.startsWith('blob:') ? url : null;
          setDataUrl(url);
          setImageSize({ w: cw, h: ch });
        } else if (!cancelled) {
          setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }

    generate();
    return () => {
      cancelled = true;
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    };
  }, [imagePaths, itemIds, wornItemIds]);

  // 选中变化 → 更新 CSS 覆盖层位置（不重绘 canvas）
  const updateOverlay = useCallback(() => {
    if (selectedItemId == null || cellsRef.current.length === 0 || !imgRef.current) {
      setOverlayStyle(null);
      return;
    }
    if (imageSize.w === 0 || imageSize.h === 0) { setOverlayStyle(null); return; }

    const cell = cellsRef.current.find((c) => c.id === selectedItemId);
    if (!cell) { setOverlayStyle(null); return; }

    const img = imgRef.current;
    const scaleX = img.clientWidth / imageSize.w;
    const scaleY = img.clientHeight / imageSize.h;

    setOverlayStyle({
      left: cell.x * scaleX,
      top: cell.y * scaleY,
      width: cell.w * scaleX,
      height: cell.h * scaleY,
    });
  }, [selectedItemId, imageSize]);

  // selectedItemId / imageSize / 窗口大小变化 → 更新覆盖层
  useEffect(() => {
    updateOverlay();
  }, [updateOverlay]);

  // 监听窗口 resize 更新覆盖层
  useEffect(() => {
    window.addEventListener('resize', updateOverlay);
    return () => window.removeEventListener('resize', updateOverlay);
  }, [updateOverlay]);

  // 图片 onLoad 后更新覆盖层
  const handleImgLoad = useCallback(() => {
    updateOverlay();
  }, [updateOverlay]);

  // 点击格子 → 选中/取消
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 同步提取坐标，避免 setTimeout 中 event 被回收
      const clientX = e.clientX;
      const clientY = e.clientY;

      // 双击判断：延迟执行单击，如果短时间内有双击则取消
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        return; // 由 handleDoubleClick 处理
      }

      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        if (!imgRef.current || cellsRef.current.length === 0) return;

        const rect = imgRef.current.getBoundingClientRect();
        const scaleX = rect.width / imageSize.w;
        const scaleY = rect.height / imageSize.h;
        const canvasX = (clientX - rect.left) / scaleX;
        const canvasY = (clientY - rect.top) / scaleY;

        const col = Math.floor(canvasX / CELL_SIZE);
        const row = Math.floor(canvasY / CELL_SIZE);
        const cells = cellsRef.current;
        const idx = row * colsRef.current + col;

        if (idx >= 0 && idx < cells.length) {
          onCellClick?.(cells[idx].id);
        }
      }, 280);
    },
    [onCellClick, imageSize],
  );

  const handleDoubleClick = useCallback(() => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    setFullscreen(true);
  }, []);

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
      <div
        className="composite-thumb"
        onClick={onCellClick ? handleClick : () => setFullscreen(true)}
        onDoubleClick={onCellClick ? handleDoubleClick : undefined}
      >
        <img
          ref={imgRef}
          src={dataUrl}
          alt={`${categoryName}组合图`}
          onLoad={handleImgLoad}
          onError={() => setError(true)}
        />
        {overlayStyle && (
          <div className="composite-cell-overlay" style={overlayStyle} />
        )}
        <span className="composite-hint">
          {onCellClick ? '单击选择 · 双击放大' : '点击放大'}
        </span>
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
