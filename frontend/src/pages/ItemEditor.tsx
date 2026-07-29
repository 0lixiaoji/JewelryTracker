import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createItem } from '../api/client';
import { useCategories } from '../contexts/CategoryContext';
import { useNotification } from '../contexts/NotificationContext';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];

export default function ItemEditor() {
  const { categories } = useCategories();
  const { notify } = useNotification();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // 处理文件选择
  const handleFile = (f: File | null) => {
    if (!f) return;
    if (!ACCEPTED_TYPES.includes(f.type)) {
      notify('不支持的图片格式，请选择 JPG/PNG/GIF/WebP/BMP', 'error');
      return;
    }
    // 清理旧预览
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  // 拖拽事件
  const handleDrag = (e: React.DragEvent, over: boolean) => {
    e.preventDefault();
    setDragOver(over);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0] ?? null);
  };

  // 清除文件
  const clearFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 提交
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || categoryId === '') return;

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('category_id', String(categoryId));
      await createItem(formData);
      notify('首饰已录入', 'success');
      navigate(`/categories/${categoryId}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : '录入失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = file && categoryId !== '';

  return (
    <div>
      <div className="page-header">
        <button className="btn-back" onClick={() => navigate('/')}>
          ← 返回
        </button>
        <h2>录入首饰</h2>
      </div>

      <form onSubmit={handleSubmit} className="item-form" style={{ maxWidth: 480 }}>
        {/* 上传区域 */}
        <label style={{ fontWeight: 600 }}>上传图片</label>
        {!preview ? (
          <div
            className={`dropzone ${dragOver ? 'dropzone-active' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={(e) => handleDrag(e, true)}
            onDragLeave={(e) => handleDrag(e, false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="dropzone-icon">{dragOver ? '📥' : '📷'}</span>
            <p>拖拽图片到这里，或点击选择</p>
            <p style={{ fontSize: '0.75rem', marginTop: 4 }}>
              支持 JPG / PNG / GIF / WebP / BMP
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </div>
        ) : (
          <div className="preview">
            <img src={preview} alt="预览" />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn-outline btn-sm" onClick={clearFile}>
                重新选择
              </button>
            </div>
          </div>
        )}

        {/* 选择分类 */}
        <label style={{ fontWeight: 600 }}>
          选择分类
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(Number(e.target.value))}
            style={{ marginTop: 6 }}
          >
            <option value="">-- 请选择 --</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name_zh}</option>
            ))}
          </select>
        </label>

        {/* 提交 */}
        <button type="submit" disabled={!canSubmit || submitting}>
          {submitting ? '提交中…' : '录入'}
        </button>
        {!canSubmit && (
          <p style={{ color: '#999', fontSize: '0.8rem' }}>
            {!file && !categoryId && '请上传图片并选择分类'}
            {!file && categoryId !== '' && '请先上传图片'}
            {file && categoryId === '' && '请先选择分类'}
          </p>
        )}
      </form>
    </div>
  );
}
