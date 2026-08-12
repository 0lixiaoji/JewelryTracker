import React, { useState, useRef, useEffect } from 'react';

export interface DropdownOption {
  value: string | number;
  label: string;
}

interface DropdownSelectProps {
  value: string | number;
  onChange: (value: string | number) => void;
  options: DropdownOption[];
  placeholder?: string;
  /** 荧光主色（默认发圈色 #e890a0），边框/辉光/选项文字均跟随 */
  accent?: string;
}

/** 十六进制颜色 → rgba() 字符串，用于荧光辉光 */
const toRgba = (hex: string, alpha: number): string => {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const DropdownSelect: React.FC<DropdownSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = '-- 请选择 --',
  accent = '#e890a0',
}) => {
  const [open, setOpen] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const triggerStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    background: toRgba(accent, 0.12),
    border: `1px solid ${accent}`,
    borderRadius: 8,
    color: '#e8dcc8',
    fontSize: '0.95rem',
    textAlign: 'left',
    cursor: 'pointer',
    boxShadow:
      `inset 0 0 10px ${toRgba(accent, 0.35)}, inset 0 2px 6px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,1), 0 0 10px ${toRgba(accent, 0.35)}, 0 0 20px ${toRgba(accent, 0.2)}`,
    transition: 'box-shadow 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    userSelect: 'none',
  };

  const popupStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    marginTop: 4,
    background: toRgba(accent, 0.1),
    backdropFilter: 'blur(3px)',
    WebkitBackdropFilter: 'blur(3px)',
    border: `1px solid ${accent}`,
    borderRadius: 12,
    overflow: 'hidden',
    zIndex: 100,
    boxShadow:
      `inset 0 0 14px ${toRgba(accent, 0.35)}, inset 0 2px 8px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,1), 0 0 14px ${toRgba(accent, 0.4)}, 0 0 32px ${toRgba(accent, 0.25)}`,
  };

  const optionStyle: React.CSSProperties = {
    padding: '10px 12px',
    color: accent,
    textShadow: '-2px -2px 0 #2c2416, -1px -2px 0 #2c2416, 0 -2px 0 #2c2416, 1px -2px 0 #2c2416, 2px -2px 0 #2c2416, -2px -1px 0 #2c2416, 2px -1px 0 #2c2416, -2px 0 0 #2c2416, 2px 0 0 #2c2416, -2px 1px 0 #2c2416, 2px 1px 0 #2c2416, -2px 2px 0 #2c2416, -1px 2px 0 #2c2416, 0 2px 0 #2c2416, 1px 2px 0 #2c2416, 2px 2px 0 #2c2416, 0 0 5px #2c2416',
    cursor: 'pointer',
    transition: 'background 0.15s',
  };

  const optionHoverStyle: React.CSSProperties = {
    background: toRgba(accent, 0.2),
  };

  const optionSelectedStyle: React.CSSProperties = {
    background: toRgba(accent, 0.25),
    color: accent,
  };

  const arrowStyle: React.CSSProperties = {
    fontSize: '0.7rem',
    color: accent,
    transition: 'transform 0.2s',
  };

  const selectedLabel =
    options.find((o) => o.value === value)?.label || placeholder;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      {/* ── 触发器 ── */}
      <button
        type="button"
        style={triggerStyle}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ color: value === '' ? '#8ec8b8' : '#e8dcc8' }}>{selectedLabel}</span>
        <span style={{ ...arrowStyle, transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          ▼
        </span>
      </button>

      {/* ── 弹出面板 ── */}
      {open && (
        <div style={popupStyle}>
          {options.map((opt, i) => {
            const isSelected = opt.value === value;
            const isHovered = hoverIndex === i;
            return (
              <div
                key={opt.value}
                style={{
                  ...optionStyle,
                  ...(isSelected ? optionSelectedStyle : {}),
                  ...(isHovered && !isSelected ? optionHoverStyle : {}),
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.value);
                  setOpen(false);
                }}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              >
                {opt.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DropdownSelect;
