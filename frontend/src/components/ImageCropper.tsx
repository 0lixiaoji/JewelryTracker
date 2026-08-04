import { useEffect, useRef, useState, useCallback } from 'react';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import { useNotification } from '../contexts/NotificationContext';

interface ImageCropperProps {
  open: boolean;
  imageUrl: string;
  fileName: string;
  onCrop: (croppedFile: File, previewUrl: string) => void;
  onCancel: () => void;
}

export default function ImageCropper({
  open,
  imageUrl,
  fileName,
  onCrop,
  onCancel,
}: ImageCropperProps) {
  const { notify } = useNotification();
  const imgRef = useRef<HTMLImageElement>(null);
  const cropperRef = useRef<Cropper | null>(null);
  const [processing, setProcessing] = useState(false);

  // 弹窗打开时锁定背景滚动 + 初始化 Cropper
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      const timer = setTimeout(() => {
        if (imgRef.current && !cropperRef.current) {
          cropperRef.current = new Cropper(imgRef.current, {
            viewMode: 1,
            dragMode: 'move',
            aspectRatio: NaN,
            autoCropArea: 0.85,
            responsive: true,
            restore: false,
            center: true,
            guides: true,
            highlight: true,
            background: false,
            modal: true,
            movable: true,
            rotatable: false,
            scalable: true,
            zoomable: true,
            zoomOnTouch: true,
            zoomOnWheel: true,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
          });
        }
      }, 100);

      return () => {
        clearTimeout(timer);
        document.body.style.overflow = prev;
        cropperRef.current?.destroy();
        cropperRef.current = null;
        setProcessing(false);
      };
    }
  }, [open]);

  // 图片 URL 变化时重建 Cropper
  useEffect(() => {
    if (open && imgRef.current) {
      cropperRef.current?.destroy();
      cropperRef.current = new Cropper(imgRef.current, {
        viewMode: 1,
        dragMode: 'move',
        aspectRatio: NaN,
        autoCropArea: 0.85,
        responsive: true,
        restore: false,
        center: true,
        guides: true,
        highlight: true,
        background: false,
        modal: true,
        movable: true,
        rotatable: false,
        scalable: true,
        zoomable: true,
        zoomOnTouch: true,
        zoomOnWheel: true,
        cropBoxMovable: true,
        cropBoxResizable: true,
        toggleDragModeOnDblclick: false,
      });
    }
  }, [imageUrl, open]);

  const handleConfirm = useCallback(async () => {
    if (!cropperRef.current) return;

    const canvas = cropperRef.current.getCroppedCanvas({
      maxWidth: 1024,
      maxHeight: 1024,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });

    if (!canvas) {
      notify('裁剪失败，请重试', 'error');
      return;
    }

    if (canvas.width < 10 || canvas.height < 10) {
      notify('裁剪区域太小，请放大后重试', 'error');
      return;
    }

    setProcessing(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) { resolve(b); return; }
            const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
            fetch(dataUrl).then((r) => r.blob()).then(resolve).catch(reject);
          },
          'image/jpeg',
          0.92,
        );
      });

      const croppedName = fileName.replace(/\.\w+$/, '_cropped.jpg');
      const croppedFile = new File([blob], croppedName, { type: 'image/jpeg' });
      const previewUrl = URL.createObjectURL(croppedFile);
      onCrop(croppedFile, previewUrl);
    } catch (err) {
      console.warn('ImageCrop error:', err);
      notify('裁剪失败，请重试', 'error');
      setProcessing(false);
    }
  }, [fileName, onCrop, notify]);

  // 切换 1:1 / 自由比例
  const toggleAspectRatio = useCallback(() => {
    if (!cropperRef.current) return;
    const data = cropperRef.current.getCropBoxData();
    const isSquare = Math.abs(data.width - data.height) < 5;
    cropperRef.current.setAspectRatio(isSquare ? NaN : 1);
  }, []);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="crop-header">
          <h3>裁剪图片</h3>
          <button type="button" className="btn-icon" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="crop-area">
          <img
            ref={imgRef}
            src={imageUrl}
            alt="裁剪"
            style={{ maxWidth: '100%', display: 'block' }}
          />
        </div>

        <div className="crop-controls">
          <button type="button" className="btn-outline btn-sm" onClick={toggleAspectRatio}>
            1:1
          </button>
          <span style={{ color: '#8ec8b8', fontSize: '0.8rem' }}>
            拖拽角点调整裁剪区域
          </span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-outline" onClick={onCancel}>
            取消
          </button>
          <button type="button" onClick={handleConfirm} disabled={processing}>
            {processing ? '处理中…' : '确认裁剪'}
          </button>
        </div>
      </div>
    </div>
  );
}
