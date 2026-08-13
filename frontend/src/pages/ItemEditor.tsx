import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createItemsBatch } from '../api/client';
import { isNative, pickFromGallery, takePhoto } from '../capacitor';
import ImageCropper from '../components/ImageCropper';
import DropdownSelect from '../components/DropdownSelect';
import { useCategories } from '../contexts/CategoryContext';
import { useNotification } from '../contexts/NotificationContext';
import { CATEGORY_ACCENTS } from '../constants/categoryColors';

interface BatchEntry {
  file: File;
  previewUrl: string;
}

/** 需要细分的分类配置：分类名 → { 选项列表, 默认值 } */
const CATEGORY_SUBTYPES: Record<string, { options: string[]; default: string }> = {
  '手链': { options: ['手链', '手镯'], default: '手镯' },
  '耳环': { options: ['耳环_h', '耳环_s'], default: '耳环_h' },
};

export default function ItemEditor() {
  const { categories, loading, error, refresh: refreshCategories } = useCategories();
  const { notify } = useNotification();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [categoryId, setCategoryId] = useState<number | ''>(() => {
    const param = searchParams.get('categoryId');
    return param ? Number(param) : '';
  });
  const [subtypeName, setSubtypeName] = useState('');
  const [batchEntries, setBatchEntries] = useState<BatchEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [customStartSeq, setCustomStartSeq] = useState('');
  const [croppingIndex, setCroppingIndex] = useState<number | null>(null);

  // ── 清理 object URL ────────────────────────────────────────
  useEffect(() => {
    return () => {
      batchEntries.forEach((e) => URL.revokeObjectURL(e.previewUrl));
    };
  }, [batchEntries]);

  // ── 切换分类时重置细分类型 ────────────────────────────────
  useEffect(() => {
    const catName = categories.find((c) => c.id === categoryId)?.name_zh ?? '';
    const cfg = CATEGORY_SUBTYPES[catName];
    setSubtypeName(cfg ? cfg.default : '');
  }, [categoryId]);

  // ── 添加文件（追加到现有列表） ──────────────────────────────
  const addFiles = (newFiles: File[]) => {
    const valid: BatchEntry[] = [];
    let rejected = 0;
    for (const f of newFiles) {
      // 空 type 放行（部分设备拍照的 MIME 为空），非空时只要是 image/* 就放行
      if (f.type !== '' && !f.type.startsWith('image/')) {
        rejected++;
        continue;
      }
      valid.push({ file: f, previewUrl: URL.createObjectURL(f) });
    }
    if (rejected > 0) {
      notify(`已跳过 ${rejected} 个不支持的图片格式`, 'info');
    }
    if (valid.length > 0) {
      setBatchEntries((prev) => [...prev, ...valid]);
    }
  };

  // ── 移除单个预览 ────────────────────────────────────────────
  const removeEntry = (index: number) => {
    setBatchEntries((prev) => {
      const entry = prev[index];
      if (entry) URL.revokeObjectURL(entry.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  // ── 清空全部 ────────────────────────────────────────────────
  const clearAll = () => {
    batchEntries.forEach((e) => URL.revokeObjectURL(e.previewUrl));
    setBatchEntries([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── 裁剪回调：替换原图为裁剪后的版本 ──────────────────
  const handleCropResult = (croppedFile: File, previewUrl: string) => {
    setBatchEntries((prev) =>
      prev.map((entry, i) => {
        if (i !== croppingIndex) return entry;
        // 释放旧 blob URL，避免内存泄漏
        URL.revokeObjectURL(entry.previewUrl);
        return { file: croppedFile, previewUrl };
      }),
    );
    setCroppingIndex(null);
  };

  // ── 拖拽事件 ────────────────────────────────────────────────
  const handleDrag = (e: React.DragEvent, over: boolean) => {
    e.preventDefault();
    setDragOver(over);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) addFiles(files);
  };

  // ── 提交 ────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (batchEntries.length === 0 || categoryId === '') return;

    setSubmitting(true);
    try {
      const files = batchEntries.map((e) => e.file);
      const seqNum = customStartSeq ? parseInt(customStartSeq, 10) : undefined;
      if (seqNum !== undefined && (isNaN(seqNum) || seqNum < 1)) {
        notify('自定义起始编号必须是正整数', 'error');
        setSubmitting(false);
        return;
      }
      await createItemsBatch(categoryId as number, files, subtypeName || undefined, seqNum);
      notify(`已录入 ${files.length} 件首饰`, 'success');
      // 刷新全局分类统计（各分类首饰数），否则仪表盘计数不更新
      refreshCategories();
      navigate(`/categories/${categoryId}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : '录入失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCategoryName = categories.find((c) => c.id === categoryId)?.name_zh ?? '';
  const subtypeConfig = CATEGORY_SUBTYPES[selectedCategoryName] ?? null;
  const canSubmit = batchEntries.length > 0 && categoryId !== ''
    && (!subtypeConfig || subtypeName !== '');
  const hasEntries = batchEntries.length > 0;

  // ── 加载中 / 错误提示 ──────────────────────────────────────
  if (loading) {
    return (
      <div className="status-msg">
        <p>正在加载分类数据…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="status-msg error">
        <p>加载分类失败：{error}</p>
        <button className="btn-outline" onClick={() => window.location.reload()} style={{ marginTop: 12 }}>
          刷新重试
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <button className="btn-back" onClick={() => navigate(-1)}>
          ← 返回
        </button>
        <h2>录入首饰</h2>
      </div>

      <form onSubmit={handleSubmit} className="item-form" style={{ maxWidth: 480 }}>
        {/* ── 上传区域（始终可见，有预览时缩小） ── */}
        <label style={{ fontWeight: 600 }}>上传图片</label>
        <div
          className={`dropzone ${dragOver ? 'dropzone-active' : ''} ${hasEntries ? 'dropzone-compact' : ''}`}
          onDragOver={(e) => handleDrag(e, true)}
          onDragLeave={(e) => handleDrag(e, false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="dropzone-icon">{dragOver ? '📥' : '📷'}</span>
          {!hasEntries ? (
            <>
              <p>拖拽图片到这里，或点击选择</p>
              <p style={{ fontSize: '0.75rem', marginTop: 4 }}>
                支持 JPG / PNG / GIF / WebP / BMP，可多选
              </p>
            </>
          ) : (
            <p>点击或拖拽添加更多图片</p>
          )}
          {isNative() && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={async (e) => {
                  e.stopPropagation();
                  const f = await takePhoto();
                  if (f) addFiles([f]);
                }}
              >
                📸 拍照
              </button>
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={async (e) => {
                  e.stopPropagation();
                  const files = await pickFromGallery();
                  if (files.length > 0) addFiles(files);
                }}
              >
                🖼️ 相册
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) addFiles(files);
            }}
          />
        </div>

        {/* ── 预览网格 ── */}
        {hasEntries && (
          <div className="batch-preview-section">
            <div className="batch-preview-header">
              <span className="batch-count">已选择 {batchEntries.length} 张图片</span>
              <button type="button" className="btn-outline btn-sm" onClick={clearAll}>
                清空全部
              </button>
            </div>
            <div className="batch-preview-grid">
              {batchEntries.map((entry, idx) => (
                <div key={`${idx}-${entry.file.name}`} className="batch-preview-card">
                  <img src={entry.previewUrl} alt={`预览 ${idx + 1}`} />
                  <div className="batch-preview-actions">
                    <button
                      type="button"
                      onClick={() => setCroppingIndex(idx)}
                      title="裁剪此图片"
                    >
                      ✂
                    </button>
                    <button
                      type="button"
                      onClick={() => removeEntry(idx)}
                      title="移除此图片"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="batch-preview-name" title={entry.file.name}>
                    {entry.file.name}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── 选择分类 ── */}
        <label style={{ fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 4 }}>
          选择分类
          <DropdownSelect
            value={categoryId}
            onChange={(v) => setCategoryId(Number(v))}
            options={categories.map((c) => ({ value: c.id, label: c.name_zh }))}
            placeholder="-- 请选择 --"
            accent={CATEGORY_ACCENTS['耳环']}
          />
        </label>

        {/* ── 细分类型（手链 / 耳环等需要细分的分类） ── */}
        {subtypeConfig && (
          <label style={{ fontWeight: 600, display: 'flex', flexDirection: 'column', gap: 4 }}>
            细分类型
            <DropdownSelect
              value={subtypeName}
              onChange={(v) => setSubtypeName(String(v))}
              options={subtypeConfig.options.map((opt) => ({ value: opt, label: opt }))}
              placeholder="-- 请选择 --"
              accent={CATEGORY_ACCENTS['耳环']}
            />
          </label>
        )}

        {/* ── 自定义起始编号（可选） ── */}
        <label style={{ fontWeight: 600 }}>
          自定义起始编号
          <span style={{ fontWeight: 400, color: '#8ec8b8', fontSize: '0.8rem', marginLeft: 8 }}>
            （可选，留空自动分配）
          </span>
          <input
            className="purple-input"
            type="number"
            min="1"
            step="1"
            value={customStartSeq}
            onChange={(e) => setCustomStartSeq(e.target.value)}
            placeholder="自动分配"
            style={{
              marginTop: 6,
              background: 'rgba(152, 136, 216, 0.12)',
              border: `1px solid ${CATEGORY_ACCENTS['手链']}`,
              borderRadius: 8,
              boxShadow: 'inset 0 0 10px rgba(152,136,216,0.35), inset 0 2px 6px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,1), 0 0 10px rgba(152,136,216,0.35), 0 0 20px rgba(152,136,216,0.2)',
            }}
          />
        </label>

        {/* ── 提交 ── */}
        <button type="submit" disabled={!canSubmit || submitting}>
          {submitting ? '提交中…' : hasEntries ? `录入 ${batchEntries.length} 件` : '录入'}
        </button>
        {!canSubmit && (
          <p style={{ color: '#8ec8b8', fontSize: '0.8rem' }}>
            {!hasEntries && categoryId === '' && '请上传图片并选择分类'}
            {!hasEntries && categoryId !== '' && '请先上传图片'}
            {hasEntries && categoryId === '' && '请先选择分类'}
            {hasEntries && subtypeConfig && subtypeName === '' && categoryId !== '' && `请选择细分类型（${subtypeConfig.options.join(' / ')}）`}
          </p>
        )}
      </form>

      {/* ── 裁剪弹窗 ── */}
      <ImageCropper
        open={croppingIndex !== null}
        imageUrl={croppingIndex !== null ? batchEntries[croppingIndex].previewUrl : ''}
        fileName={croppingIndex !== null ? batchEntries[croppingIndex].file.name : ''}
        onCrop={handleCropResult}
        onCancel={() => setCroppingIndex(null)}
      />
    </div>
  );
}
