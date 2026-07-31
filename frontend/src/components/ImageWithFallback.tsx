import { useEffect, useState } from 'react';
import { getImageBlobUrl, isBase64 } from '../db/services/imageStore';

interface Props {
  src: string;
  alt: string;
  className?: string;
}

/**
 * 图片组件 — 兼容两种存储格式：
 * 1. base64 data URL（旧格式）：直接渲染
 * 2. 文件名（新格式，如 发圈_1.jpg）：异步从 OPFS 读取并创建 blob URL
 *
 * 加载失败时显示占位图标 🖼️
 */
export default function ImageWithFallback({ src, alt, className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(
    () => isBase64(src) ? src : undefined,
  );

  useEffect(() => {
    // 已有解析结果，无需重复处理
    if (resolvedSrc) return;

    // base64 格式直接使用
    if (isBase64(src)) {
      setResolvedSrc(src);
      return;
    }

    // 文件名格式：从 OPFS 异步读取
    let cancelled = false;
    getImageBlobUrl(src).then((url) => {
      if (!cancelled && url) {
        setResolvedSrc(url);
      } else if (!cancelled) {
        setFailed(true);
      }
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => { cancelled = true; };
  }, [src, resolvedSrc]);

  // 正在从 OPFS 加载（短暂占位）
  if (!resolvedSrc && !failed) {
    return <div className={`img-loading ${className}`} title={alt} />;
  }

  // 加载失败 → 占位图标
  if (failed) {
    return (
      <div className={`img-fallback ${className}`} title={alt}>
        🖼️
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}
