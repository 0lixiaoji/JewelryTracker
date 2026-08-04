/**
 * 全屏查看器返回拦截器
 *
 * 问题：FullscreenViewer 通过 React state 打开（非路由跳转），
 * 但 useSwipeBack（左边缘右滑）和 setupBackButton（Android 返回键）
 * 都会调用 navigate(-1) / window.history.back()，导致退出 DailyWear
 * 页面而非关闭全屏查看器。
 *
 * 解决方案：全屏查看器打开时注册一个关闭回调，
 * 返回拦截逻辑优先调用该回调关闭查看器，而非执行路由回退。
 */

type BackInterceptor = () => void;

let interceptor: BackInterceptor | null = null;

/** 注册返回拦截回调，返回取消注册函数 */
export function registerBackInterceptor(cb: BackInterceptor): () => void {
  interceptor = cb;
  return () => {
    if (interceptor === cb) interceptor = null;
  };
}

/**
 * 尝试处理返回——若当前有全屏查看器打开则关闭它。
 * @returns true 表示返回已被拦截（调用方应跳过路由回退）
 */
export function handleBack(): boolean {
  if (interceptor) {
    interceptor();
    return true;
  }
  return false;
}
