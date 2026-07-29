import { useState } from 'react';

interface Props {
  src: string;
  alt: string;
  className?: string;
}

/** 图片组件 — 加载失败时显示占位图标 */
export default function ImageWithFallback({ src, alt, className = '' }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`img-fallback ${className}`} title={alt}>
        🖼️
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}
