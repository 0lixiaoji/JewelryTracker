import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  src: string;
  alt: string;
  /** 图片自然尺寸（用于初始适配 + 边界约束） */
  imageWidth: number;
  imageHeight: number;
  open: boolean;
  onClose: () => void;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

/**
 * 全屏图片查看器
 *
 * - 初始适配屏幕（图片最大边 fit 屏幕）
 * - 双指捏合缩放 (0.5x ~ 5x)
 * - 单指拖拽平移
 * - 双击切换 fit ↔ 2.5x
 * - 右上角关闭按钮 / 点击黑色背景关闭
 * - 使用 React Portal 渲染到 body
 */
export default function FullscreenViewer({
  src,
  alt,
  imageWidth,
  imageHeight,
  open,
  onClose,
}: Props) {
  const [screenSize, setScreenSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });

  const gesture = useRef<{
    startTransform: Transform;
    startTouches: Array<{ x: number; y: number }>;
    pinchStartDist: number;
    mode: 'none' | 'pan' | 'pinch';
  }>({
    startTransform: { x: 0, y: 0, scale: 1 },
    startTouches: [],
    pinchStartDist: 0,
    mode: 'none',
  });

  const lastTap = useRef(0);
  const DOUBLE_TAP_MS = 300;

  // ── 屏幕尺寸 ──────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const update = () => {
      setScreenSize({ w: window.innerWidth, h: window.innerHeight });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  // ── 适配比例：图片最大边 fit 屏幕（留 24px 边距）───

  const padding = 24;
  const fitScale =
    screenSize.w > 0 && imageWidth > 0
      ? Math.min(
          (screenSize.w - padding * 2) / imageWidth,
          (screenSize.h - padding * 2) / imageHeight,
        )
      : 1;

  // ── 边界约束 ──────────────────────────────────────────

  const clamp = useCallback(
    (t: Transform): Transform => {
      const minScale = fitScale * 0.5;
      const maxScale = Math.max(fitScale * 5, 5);
      const s = Math.min(maxScale, Math.max(minScale, t.scale));

      // fit 或更小时居中
      if (s <= fitScale + 0.005) {
        return { x: 0, y: 0, scale: fitScale };
      }

      const overX = Math.max(0, (imageWidth * s - screenSize.w) / 2);
      const overY = Math.max(0, (imageHeight * s - screenSize.h) / 2);

      return {
        x: Math.min(overX, Math.max(-overX, t.x)),
        y: Math.min(overY, Math.max(-overY, t.y)),
        scale: s,
      };
    },
    [fitScale, screenSize, imageWidth, imageHeight],
  );

  // ── 每次打开 / 屏幕变化时重置 ────────────────────────

  useEffect(() => {
    if (open && fitScale > 0) {
      setTransform({ x: 0, y: 0, scale: fitScale });
    }
  }, [open, fitScale]);

  // ── 手势 ──────────────────────────────────────────────

  const getPos = (t: React.Touch) => ({ x: t.clientX, y: t.clientY });
  const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const mid2 = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const onTouchStart = (e: React.TouchEvent) => {
    const touches = Array.from(e.touches).map(getPos);
    const g = gesture.current;
    g.startTransform = transform;
    g.startTouches = touches;

    if (touches.length >= 2) {
      g.pinchStartDist = dist2(touches[0], touches[1]);
      g.mode = 'pinch';
    } else {
      g.mode = 'pan';
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const touches = Array.from(e.touches).map(getPos);
    const g = gesture.current;

    if (g.mode === 'pinch' && touches.length >= 2) {
      const ratio = dist2(touches[0], touches[1]) / (g.pinchStartDist || 1);
      const prevMid = mid2(g.startTouches[0], g.startTouches[1]);
      const curMid = mid2(touches[0], touches[1]);
      setTransform(
        clamp({
          x: g.startTransform.x + (curMid.x - prevMid.x),
          y: g.startTransform.y + (curMid.y - prevMid.y),
          scale: g.startTransform.scale * ratio,
        }),
      );
    } else if (g.mode === 'pan' && touches.length === 1) {
      setTransform(
        clamp({
          x: g.startTransform.x + (touches[0].x - g.startTouches[0].x),
          y: g.startTransform.y + (touches[0].y - g.startTouches[0].y),
          scale: g.startTransform.scale,
        }),
      );
    }
  };

  const onTouchEnd = () => {
    gesture.current.mode = 'none';
  };

  // ── 双击 ──────────────────────────────────────────────

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      setTransform((prev) => {
        if (prev.scale > fitScale + 0.5) {
          return { x: 0, y: 0, scale: fitScale };
        }
        return { x: 0, y: 0, scale: fitScale * 2.5 };
      });
    } else {
      lastTap.current = now;
    }
  };

  // ── 关闭 ──────────────────────────────────────────────

  const handleBackdropClick = () => onClose();

  // ESC 键关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ── 阻止 body 滚动 ────────────────────────────────────

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fullscreen-overlay" onClick={handleBackdropClick}>
      {/* 关闭按钮 */}
      <button
        className="fullscreen-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="关闭"
      >
        ✕
      </button>

      {/* 图片 */}
      <div
        className="fullscreen-image-area"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleClick}
      >
        <img
          src={src}
          alt={alt}
          className="fullscreen-image"
          draggable={false}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: 'center center',
          }}
        />
      </div>
    </div>
  );
}
