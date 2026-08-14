import { useCallback, useEffect, useRef, useState } from 'react';
import { registerBackInterceptor } from '../utils/fullscreenBackInterceptor';

interface Props {
  src: string;
  alt: string;
  /** 图片自然尺寸（用于初始适配 + 边界约束） */
  imageWidth: number;
  imageHeight: number;
  open: boolean;
  onClose: () => void;
  /** 可选：左右滑动切换上一张 / 下一张（仅在图片处于 fit 尺寸时触发） */
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** 可选：位置指示（index 从 1 开始，total 为总张数；total ≤ 1 时隐藏） */
  index?: number;
  total?: number;
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
 * - 传入 onSwipeLeft/onSwipeRight 时，图片处于 fit 尺寸下横向滑动可切换上一张/下一张
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
  onSwipeLeft,
  onSwipeRight,
  index = 1,
  total = 1,
}: Props) {
  const [screenSize, setScreenSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  // 图片处于 fit 尺寸时的横向跟手位移（用于左右切换）
  const [swipeOffset, setSwipeOffset] = useState(0);

  const gesture = useRef<{
    startTransform: Transform;
    startTouches: Array<{ x: number; y: number }>;
    pinchStartDist: number;
    mode: 'none' | 'pan' | 'pinch';
    swipeOffset: number;
  }>({
    startTransform: { x: 0, y: 0, scale: 1 },
    startTouches: [],
    pinchStartDist: 0,
    mode: 'none',
    swipeOffset: 0,
  });

  const lastTap = useRef(0);
  const DOUBLE_TAP_MS = 300;
  // 滑动切换后抑制紧随其后的 click，避免误触发双击缩放
  const suppressClickRef = useRef(false);

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

  // ── 每次打开 / 切换图片 / 屏幕变化时重置 ──────────────

  useEffect(() => {
    if (open && fitScale > 0) {
      setTransform({ x: 0, y: 0, scale: fitScale });
      setSwipeOffset(0);
      gesture.current.swipeOffset = 0;
    }
  }, [open, fitScale, src]);

  // ── 手势 ──────────────────────────────────────────────

  const getPos = (t: React.Touch) => ({ x: t.clientX, y: t.clientY });
  const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const mid2 = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const onTouchStart = (e: React.TouchEvent) => {
    suppressClickRef.current = false;
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
    g.swipeOffset = 0;
    setSwipeOffset(0);
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
      const start = g.startTouches[0];
      const cur = touches[0];
      const dx = cur.x - start.x;
      const dy = cur.y - start.y;
      // 图片处于 fit（未放大）且支持左右切换时，横向滑动→跟手位移，
      // 松手时根据位移量决定切换；放大状态下仍按原逻辑平移。
      const atFit = g.startTransform.scale <= fitScale + 0.005;
      if (atFit && (onSwipeLeft || onSwipeRight)) {
        g.swipeOffset = dx;
        setSwipeOffset(dx);
      } else {
        setTransform(
          clamp({
            x: start.x + dx,
            y: start.y + dy,
            scale: g.startTransform.scale,
          }),
        );
      }
    }
  };

  const onTouchEnd = () => {
    const g = gesture.current;
    const wasPan = g.mode === 'pan';
    g.mode = 'none';

    // fit 尺寸下横向滑动结束 → 判断是否切换上一张/下一张
    if (wasPan && g.swipeOffset !== 0) {
      const threshold = Math.max(48, screenSize.w * 0.2);
      const off = g.swipeOffset;
      g.swipeOffset = 0;
      suppressClickRef.current = true; // 抑制滑动后误触发的 click（避免双击缩放）
      if (off < -threshold && onSwipeLeft) {
        setSwipeOffset(0);
        onSwipeLeft(); // 左滑 → 下一张
      } else if (off > threshold && onSwipeRight) {
        setSwipeOffset(0);
        onSwipeRight(); // 右滑 → 上一张
      } else {
        setSwipeOffset(0); // 不足阈值，回弹
      }
    }
  };

  // ── 双击 ──────────────────────────────────────────────

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
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

  // ESC 关闭 / 左右方向键切换
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onSwipeRight?.();
      else if (e.key === 'ArrowRight') onSwipeLeft?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onSwipeLeft, onSwipeRight]);

  // 拦截系统返回手势 / 按键 → 关闭查看器而非回退路由
  useEffect(() => {
    if (!open) return;
    return registerBackInterceptor(onClose);
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

      {/* 位置指示 */}
      {total > 1 && (
        <div className="fullscreen-counter">
          {index} / {total}
        </div>
      )}

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
            transform: `translate(${transform.x + swipeOffset}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: 'center center',
          }}
        />
      </div>
    </div>
  );
}
