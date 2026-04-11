import { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, Image as ImageIcon, X } from 'lucide-react';
import { toast } from 'react-toastify';
import api from '../api.js';

export default function Photos() {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  const load = async () => {
    try {
      const res = await api.get('/photos');
      setPhotos(res.data);
    } catch {
      toast.error('خطأ في تحميل الصور');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const uploadPhoto = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('photo', file);

    try {
      await api.post('/photos', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      toast.success('تم رفع الصورة');
      load();
    } catch {
      toast.error('خطأ في رفع الصورة');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const deletePhoto = async (id) => {
    if (!confirm('هل تريد حذف هذه الصورة؟')) return;
    try {
      await api.delete(`/photos/${id}`);
      toast.success('تم الحذف');
      load();
    } catch {
      toast.error('خطأ في الحذف');
    }
  };

  const updateNotes = async (id, notes) => {
    try {
      await api.put(`/photos/${id}`, { notes });
    } catch {}
  };

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-3xl font-bold text-gray-800">الصور</h2>
        <label className={`flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg transition-colors cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
          <Upload size={18} />
          رفع صورة
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={uploadPhoto}
          />
        </label>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">جاري التحميل...</div>
      ) : photos.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <ImageIcon size={48} className="mx-auto mb-4" />
          <p>لا يوجد صور بعد</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {photos.map((photo) => (
            <div key={photo.id} className="bg-white rounded-xl shadow-lg overflow-hidden group">
              <div
                className="relative h-48 bg-gray-100 cursor-pointer"
                onClick={() => setPreview(photo)}
              >
                <img
                  src={`/uploads/${photo.filename}`}
                  alt={photo.original_name}
                  className="w-full h-full object-cover"
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
                <button
                  onClick={(e) => { e.stopPropagation(); deletePhoto(photo.id); }}
                  className="absolute top-2 left-2 bg-red-500 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="p-3">
                <p className="text-xs text-gray-400 truncate">{photo.original_name}</p>
                <input
                  type="text"
                  defaultValue={photo.notes || ''}
                  onBlur={(e) => updateNotes(photo.id, e.target.value)}
                  placeholder="ملاحظة..."
                  className="w-full mt-1 text-sm border-0 border-b border-gray-200 focus:outline-none focus:border-emerald-400 py-1"
                />
                <p className="text-xs text-gray-300 mt-1">{new Date(photo.uploaded_at).toLocaleDateString('ar-SA')}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <button className="absolute top-4 left-4 text-white bg-black/50 p-2 rounded-full" onClick={() => setPreview(null)}>
            <X size={24} />
          </button>
          <img
            src={`/uploads/${preview.filename}`}
            alt={preview.original_name}
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
