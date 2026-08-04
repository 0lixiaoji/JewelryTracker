import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { handleBack } from '../utils/fullscreenBackInterceptor';

/** 左边缘检测宽度（px） */
const EDGE_WIDTH = 30;
/** 触发回退的最小滑动距离（px） */
const SWIPE_THRESHOLD = 80;

/**
 * 检测左边缘右滑手势，触发 navigate(-1) 返回上一页。
 *
 * - 仅在触摸从屏幕左边缘（30px）开始、且水平滑动 >80px 时触发
 * - 返回 `swipeProgress`（0~1）供 UI 显示滑动指示器
 * - 根路径 `/` 时不触发（无页面可回退）
 */
export function useSwipeBack() {
  const navigate = useNavigate();
  const location = useLocation();
  const [swipeProgress, setSwipeProgress] = useState(0);

  const tracking = useRef(false);
  const startX = useRef(0);
  const currentX = useRef(0);

  const isRoot = location.pathname === '/';

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (isRoot) return;
      const touch = e.touches[0];
      if (touch.clientX <= EDGE_WIDTH) {
        tracking.current = true;
        startX.current = touch.clientX;
        currentX.current = touch.clientX;
      }
    },
    [isRoot],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!tracking.current) return;
      const touch = e.touches[0];
      currentX.current = touch.clientX;
      const dx = Math.max(0, currentX.current - startX.current);
      const progress = Math.min(1, dx / SWIPE_THRESHOLD);
      setSwipeProgress(progress);
    },
    [],
  );

  const handleTouchEnd = useCallback(() => {
    if (!tracking.current) return;
    tracking.current = false;

    const dx = currentX.current - startX.current;
    if (dx >= SWIPE_THRESHOLD) {
      // 优先关闭全屏查看器，而非回退路由
      if (!handleBack()) {
        navigate(-1);
      }
    }

    // 重置指示器（延迟让动画自然结束）
    setTimeout(() => setSwipeProgress(0), 200);
  }, [navigate]);

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { swipeProgress };
}
