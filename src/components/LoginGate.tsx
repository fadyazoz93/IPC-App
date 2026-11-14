import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  Image as ImageIcon,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useFacility } from '../context/FacilityContext';
import { useToast } from '../context/ToastContext';
import { dbService } from '../services/dbService';
import { Facility } from '../types/portal';

function resolvePreviewLogoUrl(rawUrl?: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  if (
    trimmed.includes('drive.google.com') ||
    trimmed.includes('googleusercontent.com') ||
    trimmed.includes('docs.google.com')
  ) {
    const pathMatch = trimmed.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/);
    const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    const fileId = pathMatch?.[1] || queryMatch?.[1];
    if (fileId) {
      return `/api/drive-image?id=${encodeURIComponent(fileId)}`;
    }
  }
  return trimmed;
}

const LogoPreviewBox: React.FC<{ url: string; label: string }> = ({ url, label }) => {
  const [failed, setFailed] = useState(false);
  const resolved = resolvePreviewLogoUrl(url);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  return (
    <div
      className="w-11 h-11 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center shrink-0 overflow-hidden p-1"
      title={label}
    >
      {resolved && !failed ? (
        <img
          src={resolved}
          alt={label}
          className="max-w-full max-h-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageIcon className="w-4 h-4 text-slate-300" />
      )}
    </div>
  );
};

export const LoginGate: React.FC = () => {
  const { loginByFacility } = useFacility();
  const { showToast } = useToast();

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loadingFacilities, setLoadingFacilities] = useState(true);
  const [facilityNameInput, setFacilityNameInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add New Facility Inline Form (Name + Right Logo + Left Logo)
  const [showAddForm, setShowAddForm] = useState(false);
  const [newFacName, setNewFacName] = useState('');
  const [newRightLogo, setNewRightLogo] = useState('');
  const [newLeftLogo, setNewLeftLogo] = useState('');
  const [addingFacility, setAddingFacility] = useState(false);

  // Edit Existing Facility Inline Form
  const [editingFacId, setEditingFacId] = useState<string | null>(null);
  const [editFacName, setEditFacName] = useState('');
  const [editRightLogo, setEditRightLogo] = useState('');
  const [editLeftLogo, setEditLeftLogo] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Inline Delete Confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadFacilities = useCallback(async () => {
    setLoadingFacilities(true);
    try {
      const list = await dbService.getPublicFacilities();
      setFacilities(list);
      if (list.length > 0 && !facilityNameInput) {
        setFacilityNameInput(list[0].name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل قائمة المراكز.');
    } finally {
      setLoadingFacilities(false);
    }
  }, [facilityNameInput]);

  useEffect(() => {
    loadFacilities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!facilityNameInput.trim()) {
      setError('يرجى إدخال اسم المركز الطبي أو اختياره من القائمة.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await loginByFacility({
        facility_name: facilityNameInput.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر الدخول إلى المركز.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectFacilityEnter = async (fac: Facility) => {
    setError(null);
    setFacilityNameInput(fac.name);
    setSubmitting(true);
    try {
      await loginByFacility({
        facility_id: fac.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر الدخول إلى المركز.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddFacility = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFacName.trim()) return;
    setError(null);
    setAddingFacility(true);
    try {
      const created = await dbService.createPublicFacility({
        name: newFacName.trim(),
        right_logo_url: newRightLogo.trim(),
        left_logo_url: newLeftLogo.trim(),
      });
      setFacilities((prev) => [...prev, created]);
      setFacilityNameInput(created.name);
      setNewFacName('');
      setNewRightLogo('');
      setNewLeftLogo('');
      setShowAddForm(false);
      showToast(`تمت إضافة "${created.name}" بنجاح.`, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة المركز.');
    } finally {
      setAddingFacility(false);
    }
  };

  const startEditFacility = (fac: Facility) => {
    setConfirmDeleteId(null);
    setShowAddForm(false);
    setError(null);
    setEditingFacId(fac.id);
    setEditFacName(fac.name || '');
    setEditRightLogo(fac.right_logo_url || '');
    setEditLeftLogo(fac.left_logo_url || '');
  };

  const handleSaveEditFacility = async (e: React.FormEvent, id: string) => {
    e.preventDefault();
    if (!editFacName.trim()) return;
    setError(null);
    setSavingEdit(true);
    try {
      const oldFac = facilities.find((f) => f.id === id);
      const updated = await dbService.updatePublicFacility(id, {
        name: editFacName.trim(),
        right_logo_url: editRightLogo.trim(),
        left_logo_url: editLeftLogo.trim(),
      });
      setFacilities((prev) => prev.map((f) => (f.id === id ? updated : f)));
      if (oldFac && facilityNameInput.trim() === oldFac.name) {
        setFacilityNameInput(updated.name);
      }
      setEditingFacId(null);
      showToast(`تم تحديث بيانات "${updated.name}" وشعاراته الموحدة.`, 'success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث بيانات المركز.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteFacility = async (id: string) => {
    setDeletingId(id);
    setError(null);
    try {
      const deletedTarget = facilities.find((f) => f.id === id);
      await dbService.deletePublicFacility(id);
      const remaining = facilities.filter((f) => f.id !== id);
      setFacilities(remaining);
      if (deletedTarget && facilityNameInput.trim() === deletedTarget.name) {
        setFacilityNameInput(remaining[0]?.name || '');
      }
      setConfirmDeleteId(null);
      if (editingFacId === id) setEditingFacId(null);
      showToast('تم حذف المركز الطبي وبياناته.', 'info');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف المركز.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-4 sm:py-10 px-3 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
        {/* Right Column (RTL first): Brand & System Overview */}
        <div className="lg:col-span-5 bg-slate-900 text-white p-5 sm:p-8 lg:p-10 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-2.5 text-teal-300 text-sm font-semibold">
              <Activity className="w-5 h-5" />
              <span>البوابة الطبية الموحدة</span>
            </div>
            <h1 className="mt-4 sm:mt-5 text-xl sm:text-2xl lg:text-3xl font-bold leading-snug text-white">
              دخول سريع باسم المركز الطبي فقط
            </h1>
            <p className="mt-3 sm:mt-4 text-xs sm:text-sm text-slate-300 leading-relaxed">
              اختر مركزك الطبي أو اكتب اسمه للدخول مباشرة إلى الموديولات التشغيلية، مع ضبط اسم المركز
              وشعارات الترويسة (يمين ويسار) بشكل موحد لجميع الموديولات.
            </p>
          </div>

          <div className="mt-6 sm:mt-10 pt-4 sm:pt-6 border-t border-slate-800 space-y-2.5 sm:space-y-3 text-xs text-slate-300">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
              <span>عزل تام لبيانات القيادات والأقسام والعاملين لكل مركز</span>
            </div>
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
              <span>توحيد شعارات الترويسة والطباعة على مستوى المركز بالكامل</span>
            </div>
          </div>
        </div>

        {/* Left Column: Facility Login, Add Facility, Edit & Delete Facility */}
        <div className="lg:col-span-7 p-4 sm:p-8 lg:p-10">
          <div className="max-w-lg mx-auto space-y-5 sm:space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">تسجيل الدخول باسم المركز</h2>
              <p className="mt-1 text-sm text-slate-500">
                اكتب اسم المستشفى أو المركز الطبي واضغط دخول، أو اختر مباشرة من المراكز المسجلة أدناه.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
              >
                {error}
              </div>
            )}

            {/* Facility Name Login Form */}
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label htmlFor="facility-name-input" className="block text-sm font-medium text-slate-700 mb-1.5">
                  اسم المركز الطبي / المستشفى
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="facility-name-input"
                    type="text"
                    required
                    list="registered-facilities-datalist"
                    value={facilityNameInput}
                    onChange={(e) => setFacilityNameInput(e.target.value)}
                    placeholder="اكتب اسم المركز هنا..."
                    className="w-full rounded-lg border border-slate-300 bg-white pr-10 pl-3.5 py-2.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
                  />
                  <datalist id="registered-facilities-datalist">
                    {facilities.map((f) => (
                      <option key={f.id} value={f.name} />
                    ))}
                  </datalist>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || facilities.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 transition-colors cursor-pointer"
              >
                <span>{submitting ? 'جاري فتح بوابة المركز...' : 'دخول إلى المركز'}</span>
                <ArrowLeft className="w-4 h-4" />
              </button>
            </form>

            {/* Registered Facilities + Add / Edit / Delete Controls */}
            <div className="pt-5 border-t border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  المراكز المسجلة ({facilities.length})
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddForm((prev) => !prev);
                    setEditingFacId(null);
                    setError(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700 bg-teal-50/70 px-3 py-1.5 text-xs font-semibold text-teal-800 hover:bg-teal-100/80 transition-colors cursor-pointer"
                >
                  {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>{showAddForm ? 'إلغاء الإضافة' : 'إضافة مركز جديد'}</span>
                </button>
              </div>

              {/* Inline Add New Facility Panel (Name + Right Logo + Left Logo) */}
              {showAddForm && (
                <form
                  onSubmit={handleAddFacility}
                  className="rounded-xl border border-teal-200 bg-teal-50/40 p-4 space-y-3"
                >
                  <div>
                    <label htmlFor="new-facility-name" className="block text-xs font-bold text-slate-800 mb-1">
                      اسم المركز
                    </label>
                    <input
                      id="new-facility-name"
                      type="text"
                      required
                      value={newFacName}
                      onChange={(e) => setNewFacName(e.target.value)}
                      placeholder="اكتب اسم المركز أو المستشفى..."
                      className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="new-facility-right-logo" className="block text-xs font-bold text-slate-800">
                        اللوجو في جهة اليمين
                      </label>
                      {newRightLogo && (
                        <button
                          type="button"
                          onClick={() => setNewRightLogo('')}
                          className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 cursor-pointer"
                        >
                          مسح
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <LogoPreviewBox url={newRightLogo} label="معاينة شعار اليمين" />
                      <input
                        id="new-facility-right-logo"
                        type="url"
                        dir="ltr"
                        value={newRightLogo}
                        onChange={(e) => setNewRightLogo(e.target.value)}
                        placeholder="https://drive.google.com/file/d/.../view"
                        className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="new-facility-left-logo" className="block text-xs font-bold text-slate-800">
                        اللوجو في جهة اليسار
                      </label>
                      {newLeftLogo && (
                        <button
                          type="button"
                          onClick={() => setNewLeftLogo('')}
                          className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 cursor-pointer"
                        >
                          مسح
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <LogoPreviewBox url={newLeftLogo} label="معاينة شعار اليسار" />
                      <input
                        id="new-facility-left-logo"
                        type="url"
                        dir="ltr"
                        value={newLeftLogo}
                        onChange={(e) => setNewLeftLogo(e.target.value)}
                        placeholder="https://drive.google.com/file/d/.../view"
                        className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500">
                    يتم تطبيق هذه الشعارات بشكل موحد في ترويسة التقارير والطباعة بجميع الموديولات (روابط مباشرة أو Google Drive).
                  </p>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={addingFacility}
                      className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                    >
                      {addingFacility ? 'جاري الإضافة...' : 'حفظ وإضافة المركز'}
                    </button>
                  </div>
                </form>
              )}

              {/* Facilities List */}
              {loadingFacilities ? (
                <div className="space-y-2">
                  <div className="h-12 rounded-lg bg-slate-100 animate-pulse" />
                  <div className="h-12 rounded-lg bg-slate-100 animate-pulse" />
                </div>
              ) : facilities.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
                  لا توجد مراكز طبية مسجلة حالياً. اضغط على "إضافة مركز جديد" للبدء.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pl-1">
                  {facilities.map((fac) => {
                    const isConfirming = confirmDeleteId === fac.id;
                    const isEditing = editingFacId === fac.id;
                    const isSelected = facilityNameInput.trim() === fac.name;

                    if (isEditing) {
                      return (
                        <form
                          key={fac.id}
                          onSubmit={(e) => handleSaveEditFacility(e, fac.id)}
                          className="rounded-xl border border-teal-300 bg-teal-50/40 p-3.5 space-y-2.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-teal-900">تعديل بيانات المركز</span>
                            <button
                              type="button"
                              onClick={() => setEditingFacId(null)}
                              className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                              aria-label="إلغاء التعديل"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              اسم المركز
                            </label>
                            <input
                              type="text"
                              required
                              value={editFacName}
                              onChange={(e) => setEditFacName(e.target.value)}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-[11px] font-bold text-slate-700">
                                اللوجو في جهة اليمين
                              </label>
                              {editRightLogo && (
                                <button
                                  type="button"
                                  onClick={() => setEditRightLogo('')}
                                  className="text-[11px] text-rose-600 hover:text-rose-700 cursor-pointer"
                                >
                                  مسح
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <LogoPreviewBox url={editRightLogo} label="معاينة شعار اليمين" />
                              <input
                                type="url"
                                dir="ltr"
                                value={editRightLogo}
                                onChange={(e) => setEditRightLogo(e.target.value)}
                                placeholder="https://drive.google.com/file/d/.../view"
                                className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="block text-[11px] font-bold text-slate-700">
                                اللوجو في جهة اليسار
                              </label>
                              {editLeftLogo && (
                                <button
                                  type="button"
                                  onClick={() => setEditLeftLogo('')}
                                  className="text-[11px] text-rose-600 hover:text-rose-700 cursor-pointer"
                                >
                                  مسح
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <LogoPreviewBox url={editLeftLogo} label="معاينة شعار اليسار" />
                              <input
                                type="url"
                                dir="ltr"
                                value={editLeftLogo}
                                onChange={(e) => setEditLeftLogo(e.target.value)}
                                placeholder="https://drive.google.com/file/d/.../view"
                                className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                              />
                            </div>
                          </div>

                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingFacId(null)}
                              className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 cursor-pointer"
                            >
                              إلغاء
                            </button>
                            <button
                              type="submit"
                              disabled={savingEdit}
                              className="min-h-[38px] rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                            >
                              {savingEdit ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                            </button>
                          </div>
                        </form>
                      );
                    }

                    return (
                      <div
                        key={fac.id}
                        className={`rounded-lg border px-3 py-2 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 transition-colors ${
                          isSelected ? 'border-teal-600 bg-teal-50/40' : 'border-slate-200 bg-slate-50/60'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setFacilityNameInput(fac.name)}
                          className="flex-1 text-right min-w-[140px] min-h-[38px] flex items-center cursor-pointer"
                        >
                          <p className="text-sm font-semibold text-slate-900 truncate">{fac.name}</p>
                        </button>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isConfirming ? (
                            <>
                              <button
                                type="button"
                                disabled={deletingId === fac.id}
                                onClick={() => handleDeleteFacility(fac.id)}
                                className="min-h-[36px] rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
                              >
                                {deletingId === fac.id ? 'جاري...' : 'تأكيد الحذف'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="min-h-[36px] rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 cursor-pointer"
                              >
                                إلغاء
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDirectFacilityEnter(fac)}
                                disabled={submitting}
                                className="min-h-[36px] rounded-md bg-white border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-800 hover:border-teal-700 hover:text-teal-800 cursor-pointer"
                              >
                                دخول
                              </button>
                              <button
                                type="button"
                                onClick={() => startEditFacility(fac)}
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-400 hover:bg-teal-50 hover:text-teal-700 transition-colors cursor-pointer"
                                aria-label={`تعديل ${fac.name}`}
                                title="تعديل الاسم والشعارات"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(fac.id)}
                                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                                aria-label={`حذف ${fac.name}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
