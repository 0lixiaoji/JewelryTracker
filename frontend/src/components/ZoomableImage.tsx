import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  src: string;
  alt: string;
  /** 图片自然宽度（canvas 绑制宽度） */
  imageWidth?: number;
  /** 图片自然高度（canvas 绑制高度） */
  imageHeight?: number;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

/**
 * 可缩放图片组件
 *
 * 触摸手势：
 * - 双指捏合缩放（0.5x ~ 4x）
 * - 单指拖拽平移（仅在放大后）
 * - 双击切换 fit ↔ 2.5x
 *
 * 初始状态图片适配容器宽度，居中显示。
 * 容器用 flex 居中图片，transform 在 centered 基础上叠加 pan + scale。
 */
export default function ZoomableImage({ src, alt, imageWidth, imageHeight }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });

  // 手势追踪
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

  // 双击检测
  const lastTap = useRef(0);
  const DOUBLE_TAP_MS = 300;

  // ── 容器尺寸 ──────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── 初始适配比例 ──────────────────────────────────────

  const fitScale =
    containerSize.w > 0 && imageWidth ? containerSize.w / imageWidth : 1;

  // ── 边界限制 ──────────────────────────────────────────

  const clamp = useCallback(
    (t: Transform): Transform => {
      const iw = imageWidth ?? containerSize.w;
      const ih = imageHeight ?? containerSize.h;
      const minScale = fitScale * 0.5;
      const maxScale = Math.max(fitScale * 4, 4);
      const s = Math.min(maxScale, Math.max(minScale, t.scale));

      // 当缩放到 fitScale 或更小时，强制居中
      if (s <= fitScale + 0.005) {
        return { x: 0, y: 0, scale: fitScale };
      }

      // 图片渲染尺寸超出容器时，限制平移防止露出空白边缘
      const overX = Math.max(0, (iw * s - containerSize.w) / 2);
      const overY = Math.max(0, (ih * s - containerSize.h) / 2);

      return {
        x: Math.min(overX, Math.max(-overX, t.x)),
        y: Math.min(overY, Math.max(-overY, t.y)),
        scale: s,
      };
    },
    [fitScale, containerSize, imageWidth, imageHeight],
  );

  // ── 手势 ──────────────────────────────────────────────

  const getTouchPos = (t: React.Touch) => ({ x: t.clientX, y: t.clientY });
  const touchDist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const touchMid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const onTouchStart = (e: React.TouchEvent) => {
    const touches = Array.from(e.touches).map(getTouchPos);
    const g = gesture.current;
    g.startTransform = transform; // 捕获当前 transform 快照
    g.startTouches = touches;

    if (touches.length >= 2) {
      g.pinchStartDist = touchDist(touches[0], touches[1]);
      g.mode = 'pinch';
    } else if (touches.length === 1) {
      g.mode = 'pan';
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const touches = Array.from(e.touches).map(getTouchPos);
    const g = gesture.current;

    if (g.mode === 'pinch' && touches.length >= 2) {
      const curDist = touchDist(touches[0], touches[1]);
      const ratio = curDist / (g.pinchStartDist || 1);
      const prevMid = touchMid(g.startTouches[0], g.startTouches[1]);
      const curMid = touchMid(touches[0], touches[1]);

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

  const onClick = () => {
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

  // ── 容器尺寸变化时重设 fitScale ──────────────────────

  useEffect(() => {
    setTransform({ x: 0, y: 0, scale: fitScale });
  }, [fitScale]);

  return (
    <div
      ref={containerRef}
      className="zoomable-container"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={onClick}
    >
      <img
        src={src}
        alt={alt}
        className="zoomable-image"
        draggable={false}
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: 'center center',
        }}
      />
    </div>
  );
}
