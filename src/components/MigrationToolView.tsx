import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  FileUp,
  HardDrive,
  Layers,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import { useFacility } from '../context/FacilityContext';
import { useToast } from '../context/ToastContext';
import { dbService } from '../services/dbService';
import {
  DetectedSourceTable,
  MigrationSummary,
  MigrationTargetDestination,
  SmartMigrationTableEntry,
  TursoBackupBundle,
  TursoRestoreSummary,
  TursoStatusInfo,
} from '../types/portal';

const TARGET_OPTIONS: Array<{ value: MigrationTargetDestination; label: string }> = [
  { value: 'leaders', label: 'البيانات الأساسية: القيادات' },
  { value: 'module_one_settings', label: 'إعدادات تقارير المرور' },
  { value: 'module_two_settings', label: 'إعدادات البرنامج التدريبي' },
  { value: 'module_three_settings', label: 'إعدادات إحصائية غسيل الأيدي' },
  { value: 'departments', label: 'البيانات الأساسية: الأقسام والوحدات' },
  { value: 'staff', label: 'البيانات الأساسية: العاملون' },
  { value: 'module_one', label: 'سجلات تقارير المرور' },
  { value: 'module_two', label: 'سجلات البرنامج التدريبي' },
  { value: 'module_three', label: 'سجلات إحصائية غسيل الأيدي' },
  { value: 'ignore', label: 'تجاهل الجدول' },
];

const suggestTargetDestination = (
  tableName: string,
  columns: string[]
): MigrationTargetDestination => {
  const nameLower = tableName.toLowerCase();
  const colsLower = columns.map((c) => c.toLowerCase());
  const hasCol = (...keys: string[]) => keys.some((k) => colsLower.includes(k));

  if (
    nameLower.includes('leader') ||
    nameLower.includes('قياد') ||
    hasCol('hospital_director', 'ic_supervisor', 'quality_director', 'nursing_director')
  ) {
    return 'leaders';
  }

  const isSettingsLike =
    nameLower.includes('setting') ||
    nameLower.includes('config') ||
    nameLower.includes('اعداد') ||
    (hasCol('type', 'value') && colsLower.length <= 4);

  if (isSettingsLike || hasCol('header1', 'profcategories', 'procedures', 'rightlogourl', 'logoright')) {
    if (
      nameLower.includes('module_three') ||
      nameLower.includes('hand') ||
      nameLower.includes('hygiene') ||
      nameLower.includes('compliance') ||
      nameLower.includes('who') ||
      hasCol('header1', 'header2', 'header3', 'logoright', 'logoleft', 'profcategories', 'observers')
    ) {
      return 'module_three_settings';
    }
    if (
      nameLower.includes('module_two') ||
      nameLower.includes('training') ||
      nameLower.includes('train') ||
      (hasCol('type', 'value') && colsLower.length <= 4)
    ) {
      return 'module_two_settings';
    }
    return 'module_one_settings';
  }

  if (
    nameLower.includes('dept') ||
    nameLower.includes('department') ||
    nameLower.includes('ward') ||
    nameLower.includes('قسم')
  ) {
    return 'departments';
  }
  if (
    nameLower.includes('staff') ||
    nameLower.includes('employee') ||
    nameLower.includes('worker') ||
    nameLower.includes('عامل') ||
    nameLower.includes('موظف') ||
    hasCol('employee_code')
  ) {
    return 'staff';
  }
  if (
    nameLower.includes('module_one') ||
    nameLower.includes('report') ||
    nameLower.includes('weekly') ||
    nameLower.includes('inspection') ||
    hasCol('evaluations', 'inspector', 'supervisor', 'report_type')
  ) {
    return 'module_one';
  }
  if (
    nameLower.includes('module_two') ||
    nameLower.includes('training') ||
    nameLower.includes('plan') ||
    nameLower.includes('تدريب') ||
    hasCol('traineename', 'trainer', 'policies', 'program_title')
  ) {
    return 'module_two';
  }
  if (
    nameLower.includes('module_three') ||
    nameLower.includes('hand') ||
    nameLower.includes('hygiene') ||
    nameLower.includes('observation') ||
    nameLower.includes('compliance') ||
    nameLower.includes('session') ||
    hasCol('sessionid', 'session_id', 'indication', 'opportunities', 'actions', 'compliance_rate')
  ) {
    return 'module_three';
  }
  if (hasCol('name', 'type') && !hasCol('employee_code')) {
    return 'departments';
  }
  return 'ignore';
};

export const MigrationToolView: React.FC = () => {
  const { session, refreshMasterData, refreshFacilities } = useFacility();
  const { showToast } = useToast();

  const targetFacilityId = session?.active_facility_id || '';

  // Turso Cloud Status / Backup / Restore State
  const [tursoStatus, setTursoStatus] = useState<TursoStatusInfo | null>(null);
  const [loadingTurso, setLoadingTurso] = useState(false);
  const [tursoError, setTursoError] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');
  const [pendingBackup, setPendingBackup] = useState<{
    fileName: string;
    bundle: TursoBackupBundle;
    totalRows: number;
  } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<TursoRestoreSummary | null>(null);

  // Smart SQLite/JSON Migration State
  const [fileName, setFileName] = useState<string>('');
  const [fileType, setFileType] = useState<'sqlite' | 'json' | null>(null);
  const [detectedTables, setDetectedTables] = useState<DetectedSourceTable[]>([]);
  const [tableMappings, setTableMappings] = useState<Record<string, MigrationTargetDestination>>({});
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [lastSummary, setLastSummary] = useState<MigrationSummary | null>(null);

  const loadTursoStatus = useCallback(async () => {
    setLoadingTurso(true);
    setTursoError(null);
    try {
      const info = await dbService.getTursoStatus();
      setTursoStatus(info);
    } catch (err) {
      setTursoError(err instanceof Error ? err.message : 'تعذر الاتصال بقاعدة البيانات.');
    } finally {
      setLoadingTurso(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user.role === 'super_admin') {
      void loadTursoStatus();
    }
  }, [session?.user.role, loadTursoStatus]);

  const activeMappingCount = useMemo(
    () => detectedTables.filter((t) => (tableMappings[t.tableName] || 'ignore') !== 'ignore').length,
    [detectedTables, tableMappings]
  );

  const totalMappedRows = useMemo(
    () =>
      detectedTables.reduce(
        (sum, t) => sum + ((tableMappings[t.tableName] || 'ignore') !== 'ignore' ? t.rowCount : 0),
        0
      ),
    [detectedTables, tableMappings]
  );

  if (!session) {
    return null;
  }

  const handleDownloadTursoBackup = async () => {
    setBackingUp(true);
    try {
      const bundle = await dbService.downloadTursoBackup();
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `medhub-turso-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('تم حفظ وتنزيل النسخة الاحتياطية الكاملة بنجاح.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'فشل تصدير النسخة الاحتياطية.', 'error');
    } finally {
      setBackingUp(false);
    }
  };

  const handleSelectRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setRestoreResult(null);
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as TursoBackupBundle;
      if (!parsed || typeof parsed !== 'object' || !parsed.tables || typeof parsed.tables !== 'object') {
        throw new Error('ملف النسخة الاحتياطية غير صالح (يجب أن يكون بصيغة medhub_turso_backup_v1).');
      }
      const totalRows = Object.values(parsed.tables).reduce(
        (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
        0
      );
      setPendingBackup({
        fileName: file.name,
        bundle: parsed,
        totalRows,
      });
    } catch (err) {
      setPendingBackup(null);
      showToast(
        err instanceof Error ? err.message : 'تعذر قراءة ملف النسخة الاحتياطية.',
        'error'
      );
    }
  };

  const handleExecuteTursoRestore = async () => {
    if (!pendingBackup) return;
    setRestoring(true);
    setRestoreResult(null);
    try {
      const summary = await dbService.restoreTursoBackup(restoreMode, pendingBackup.bundle);
      setRestoreResult(summary);
      setPendingBackup(null);
      await refreshFacilities();
      await refreshMasterData(true);
      await loadTursoStatus();
      showToast(
        `تمت استعادة ${summary.total_restored} سجل إلى قاعدة البيانات بنجاح.`,
        'success'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'فشلت استعادة النسخة الاحتياطية.', 'error');
    } finally {
      setRestoring(false);
    }
  };

  const parseSqliteDatabase = async (file: File): Promise<DetectedSourceTable[]> => {
    const [{ default: initSqlJs }, { default: wasmSource }] = await Promise.all([
      import('sql.js'),
      import('sql.js/dist/sql-wasm-browser.wasm?url&inline'),
    ]);

    let wasmBinary: ArrayBuffer;
    if (wasmSource.startsWith('data:')) {
      const commaIdx = wasmSource.indexOf(',');
      const base64 = commaIdx >= 0 ? wasmSource.slice(commaIdx + 1) : wasmSource;
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      wasmBinary = bytes.buffer;
    } else {
      const res = await fetch(wasmSource, { credentials: 'same-origin' });
      if (!res.ok) {
        throw new Error(`تعذر تحميل محرك قراءة SQLite (${res.status}).`);
      }
      wasmBinary = await res.arrayBuffer();
    }

    const SQL = await initSqlJs({ wasmBinary });
    const buffer = await file.arrayBuffer();
    const sqliteDb = new SQL.Database(new Uint8Array(buffer));

    try {
      const tableQuery = sqliteDb.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      );
      if (!tableQuery.length || !tableQuery[0].values.length) {
        throw new Error('ملف قاعدة البيانات لا يحتوي على أي جداول قابلة للقراءة.');
      }

      const tableNames = tableQuery[0].values.map((row) => String(row[0]));
      const tables: DetectedSourceTable[] = [];

      for (const tableName of tableNames) {
        const escaped = `"${tableName.replace(/"/g, '""')}"`;
        const pragmaRes = sqliteDb.exec(`PRAGMA table_info(${escaped})`);
        const columns: string[] = pragmaRes.length
          ? pragmaRes[0].values.map((col) => String(col[1]))
          : [];

        const dataRes = sqliteDb.exec(`SELECT * FROM ${escaped}`);
        const rows: Array<Record<string, unknown>> = [];
        if (dataRes.length && dataRes[0].values.length) {
          const resultCols = dataRes[0].columns;
          for (const values of dataRes[0].values) {
            const obj: Record<string, unknown> = {};
            resultCols.forEach((colName, idx) => {
              obj[colName] = values[idx];
            });
            rows.push(obj);
          }
        }

        tables.push({
          tableName,
          rowCount: rows.length,
          columns,
          rows,
          suggestedTarget: suggestTargetDestination(tableName, columns),
        });
      }

      return tables;
    } finally {
      sqliteDb.close();
    }
  };

  const parseJsonFile = async (file: File): Promise<DetectedSourceTable[]> => {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const tables: DetectedSourceTable[] = [];

    if (Array.isArray(parsed)) {
      const rows = parsed.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
      const columns = rows.length ? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))) : [];
      tables.push({
        tableName: 'records',
        rowCount: rows.length,
        columns,
        rows,
        suggestedTarget: suggestTargetDestination('records', columns),
      });
      return tables;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('صيغة ملف JSON غير صالحة للترحيل.');
    }

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        const rows = value.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
        const columns = rows.length ? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))) : [];
        tables.push({
          tableName: key,
          rowCount: rows.length,
          columns,
          rows,
          suggestedTarget: suggestTargetDestination(key, columns),
        });
      } else if (typeof value === 'object' && value !== null) {
        const row = value as Record<string, unknown>;
        const columns = Object.keys(row);
        tables.push({
          tableName: key,
          rowCount: 1,
          columns,
          rows: [row],
          suggestedTarget: suggestTargetDestination(key, columns),
        });
      }
    }

    if (tables.length === 0) {
      throw new Error('لم يتم العثور على أي جداول أو سجلات صالحة داخل ملف JSON.');
    }
    return tables;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setParseError(null);
    setLastSummary(null);
    setDetectedTables([]);
    setTableMappings({});
    setFileType(null);

    if (!file) {
      setFileName('');
      return;
    }

    setFileName(file.name);
    setParsing(true);
    try {
      const lower = file.name.toLowerCase();
      const isSqlite = lower.endsWith('.db') || lower.endsWith('.sqlite') || lower.endsWith('.sqlite3');
      const tables = isSqlite ? await parseSqliteDatabase(file) : await parseJsonFile(file);

      setFileType(isSqlite ? 'sqlite' : 'json');
      setDetectedTables(tables);

      const initialMap: Record<string, MigrationTargetDestination> = {};
      for (const t of tables) {
        initialMap[t.tableName] = t.suggestedTarget;
      }
      setTableMappings(initialMap);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : 'تعذر قراءة الملف المختار. تأكد من سلامة صيغة SQLite أو JSON.'
      );
    } finally {
      setParsing(false);
    }
  };

  const handleDownloadSample = () => {
    const sample = {
      leaders: {
        hospital_director: 'د. طارق عبد الحميد',
        quality_director: 'د. نيفين صلاح الدين',
        ic_supervisor: 'د. وليد مصطفى',
        nursing_director: 'أ. إيناس محمد علي',
      },
      module_one_settings: {
        hospitalName: session.active_facility_name,
        teamSignature: 'د. وليد مصطفى',
        managerSignature: 'د. طارق عبد الحميد',
        periods: ['صباحي', 'مسائي', 'ليلي'],
        departments: ['وحدة القسطرة القلبية', 'بنك الدم الفرعي'],
        procedures: [],
      },
      module_two_settings: [
        { Type: 'Hospital_Name', Value: session.active_facility_name },
        { Type: 'Trainer', Value: 'د. وليد مصطفى' },
        { Type: 'Policy', Value: 'مكافحة العدوى المعملية' },
      ],
      module_three_settings: {
        header1: session.active_facility_name,
        header2: 'وحدة مكافحة العدوى',
        header3: 'إحصائية غسيل الأيدي',
        departments: ['وحدة القسطرة القلبية', 'بنك الدم الفرعي'],
        services: ['Cardiology'],
        wards: ['Cath Lab'],
        observers: ['WM'],
        cities: ['القاهرة'],
        profCategories: ['أطباء', 'تمريض'],
      },
      departments: [
        { id: 'legacy-dep-1', name: 'وحدة القسطرة القلبية', type: 'طوارئ وعمليات' },
        { id: 'legacy-dep-2', name: 'بنك الدم الفرعي', type: 'معاون وخدمي' },
      ],
      staff: [
        {
          id: 'legacy-stf-1',
          name: 'د. حاتم عبد الله',
          employee_code: 'LEG-501',
          category: 'طبيب',
          department_id: 'legacy-dep-1',
        },
      ],
      module_one_records: [
        {
          id: 'legacy-m1-501',
          department_id: 'legacy-dep-1',
          status: 'completed',
          payload: {
            report_type: 'تقارير المرور الأسبوعية',
            date: '2026-10-12',
            period: 'صباحي',
            department: 'وحدة القسطرة القلبية',
            inspector: 'د. وليد مصطفى',
            supervisor: 'أ. إيناس محمد علي',
            evaluations: [
              {
                procedure: 'توفر مستلزمات غسيل الأيدي',
                status: 'Yes',
                note: '',
                rec: '',
              },
            ],
          },
        },
      ],
      module_two_records: [
        {
          id: 'legacy-m2-501',
          department_id: 'legacy-dep-2',
          status: 'training_log',
          payload: {
            record_type: 'training_log',
            Date: '2026-10-14',
            Category: 'تمريض',
            Policies: 'مكافحة العدوى المعملية',
            TraineeName: 'د. حاتم عبد الله',
            Trainer: 'د. وليد مصطفى',
          },
        },
      ],
      module_three_records: [
        {
          id: 'legacy-m3-501',
          department_id: 'legacy-dep-1',
          status: 'hand_hygiene',
          payload: {
            record_type: 'hand_hygiene',
            sessionInfo: {
              sessionId: 'legacy-hh-501',
              date: '2026-10-20',
              department: 'وحدة القسطرة القلبية',
              observer: 'WM',
            },
            professionals: [],
          },
        },
      ],
    };

    const blob = new Blob([JSON.stringify(sample, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'smart_migration_sample.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExecuteMigration = async () => {
    if (!targetFacilityId || activeMappingCount === 0) return;
    setMigrating(true);
    try {
      const payloadTables: SmartMigrationTableEntry[] = detectedTables
        .map((t) => ({
          sourceTable: t.tableName,
          target: tableMappings[t.tableName] || 'ignore',
          rows: t.rows,
        }))
        .filter((t) => t.target !== 'ignore');

      const summary = await dbService.executeSmartMigration(targetFacilityId, payloadTables);
      setLastSummary(summary);
      await refreshMasterData(true);
      await loadTursoStatus();
      showToast('تم تنفيذ الترحيل الموحد على مرحلتين وتوليد المعرفات الجديدة بنجاح.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'فشلت عملية الترحيل.', 'error');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Turso Cloud Database & Vercel Env Backup/Restore Section */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Cloud className="w-5 h-5 text-teal-700" />
              <h2 className="text-lg font-bold text-slate-900">
                قاعدة بيانات Turso السحابية والنسخ الاحتياطي (Vercel Env)
              </h2>
              {tursoStatus && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-xs font-bold ${
                    tursoStatus.isTursoRemote
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      tursoStatus.isTursoRemote ? 'bg-emerald-600' : 'bg-amber-500'
                    }`}
                  />
                  {tursoStatus.isTursoRemote ? 'متصل بـ Turso السحابي' : 'وضع SQLite المحلي'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              عرض البيانات المحفوظة فعلياً على Turso، حفظ نسخة احتياطية كاملة بصيغة JSON، واستعادتها مباشرة عبر متغيرات البيئة في Vercel.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadTursoStatus}
              disabled={loadingTurso}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTurso ? 'animate-spin' : ''}`} />
              <span>تحديث / عرض بيانات Turso</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadTursoBackup}
              disabled={backingUp}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{backingUp ? 'جاري التصدير...' : 'حفظ نسخة احتياطية كاملة (JSON)'}</span>
            </button>
          </div>
        </div>

        {tursoError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 flex items-center gap-2 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{tursoError}</span>
          </div>
        )}

        {tursoStatus && (
          <>
            {/* Connection & Env Var Readiness */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">نطاق الاتصال النشط:</span>
                  <span className="font-mono text-slate-800 font-semibold" dir="ltr">
                    {tursoStatus.databaseUrlMasked || 'file:portal.db'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">زمن الاستجابة (Ping):</span>
                  <span className="font-mono-nums font-bold text-teal-800" dir="ltr">
                    {tursoStatus.latency_ms} ms
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 font-medium">بيئة التشغيل:</span>
                  <span className="font-semibold text-slate-700">
                    {tursoStatus.isVercel ? 'Vercel Serverless' : 'خادم Node محلي'}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
                <span className="block text-slate-600 font-bold mb-1">
                  حالة متغيرات البيئة (Environment Variables):
                </span>
                <div className="flex flex-wrap gap-2" dir="ltr">
                  <span
                    className={`px-2 py-1 rounded text-[11px] font-mono font-semibold border ${
                      tursoStatus.hasDatabaseUrlEnv
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    TURSO_DATABASE_URL: {tursoStatus.hasDatabaseUrlEnv ? 'Configured' : 'Not Set'}
                  </span>
                  <span
                    className={`px-2 py-1 rounded text-[11px] font-mono font-semibold border ${
                      tursoStatus.hasAuthToken
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    TURSO_AUTH_TOKEN: {tursoStatus.hasAuthToken ? 'Configured' : 'Not Set'}
                  </span>
                </div>
              </div>
            </div>

            {!tursoStatus.isTursoRemote && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <HardDrive className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>لتفعيل الحفظ السحابي الدائم على Turso عبر Vercel:</span>
                </p>
                <p className="text-amber-800 leading-relaxed">
                  أضف المتغيرين{' '}
                  <span className="font-mono font-bold bg-white/80 px-1.5 py-0.5 rounded border border-amber-200" dir="ltr">
                    TURSO_DATABASE_URL
                  </span>{' '}
                  و{' '}
                  <span className="font-mono font-bold bg-white/80 px-1.5 py-0.5 rounded border border-amber-200" dir="ltr">
                    TURSO_AUTH_TOKEN
                  </span>{' '}
                  في إعدادات <span dir="ltr">Vercel Project Settings &gt; Environment Variables</span> ثم أعد النشر. يمكنك حالياً حفظ نسخة احتياطية كاملة واستعادتها فور ربط القاعدة.
                </p>
              </div>
            )}

            {/* Live Record Counts */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <span className="text-slate-500 block">المراكز الطبية</span>
                <strong className="font-mono-nums text-base text-slate-900">
                  {tursoStatus.counts.facilities}
                </strong>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <span className="text-slate-500 block">الأقسام والوحدات</span>
                <strong className="font-mono-nums text-base text-slate-900">
                  {tursoStatus.counts.facility_departments}
                </strong>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <span className="text-slate-500 block">العاملون</span>
                <strong className="font-mono-nums text-base text-slate-900">
                  {tursoStatus.counts.facility_staff}
                </strong>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <span className="text-slate-500 block">تقارير المرور</span>
                <strong className="font-mono-nums text-base text-teal-800">
                  {tursoStatus.counts.module_one_records}
                </strong>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <span className="text-slate-500 block">سجلات التدريب</span>
                <strong className="font-mono-nums text-base text-teal-800">
                  {tursoStatus.counts.module_two_records}
                </strong>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <span className="text-slate-500 block">جلسات غسيل الأيدي</span>
                <strong className="font-mono-nums text-base text-teal-800">
                  {tursoStatus.counts.module_three_records}
                </strong>
              </div>
            </div>

            {/* Live Facilities Breakdown on Turso */}
            {tursoStatus.facilities_summary && tursoStatus.facilities_summary.length > 0 && (
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>عرض المراكز والبيانات المسجلة في القاعدة حالياً</span>
                  <span className="font-mono-nums text-slate-500">
                    {tursoStatus.facilities_summary.length} مركز
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-slate-50/60 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">اسم المركز</th>
                        <th className="px-3 py-2">الكود</th>
                        <th className="px-3 py-2">الأقسام</th>
                        <th className="px-3 py-2">العاملون</th>
                        <th className="px-3 py-2">تقارير المرور</th>
                        <th className="px-3 py-2">التدريب</th>
                        <th className="px-3 py-2">غسيل الأيدي</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tursoStatus.facilities_summary.map((fac) => (
                        <tr key={fac.id} className="hover:bg-slate-50/70">
                          <td className="px-3 py-2 font-semibold text-slate-900">{fac.name}</td>
                          <td className="px-3 py-2 font-mono text-slate-600" dir="ltr">
                            {fac.code}
                          </td>
                          <td className="px-3 py-2 font-mono-nums">{fac.departments_count}</td>
                          <td className="px-3 py-2 font-mono-nums">{fac.staff_count}</td>
                          <td className="px-3 py-2 font-mono-nums">{fac.module_one_count}</td>
                          <td className="px-3 py-2 font-mono-nums">{fac.module_two_count}</td>
                          <td className="px-3 py-2 font-mono-nums">{fac.module_three_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Restore Backup to Turso */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">استعادة نسخة احتياطية إلى قاعدة البيانات</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                ارفع ملف النسخة الاحتياطية الكاملة (<span dir="ltr">.json</span>) لاسترجاع كافة المراكز والإعدادات والسجلات إلى Turso.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={restoreMode}
                onChange={(e) => setRestoreMode(e.target.value as 'merge' | 'replace')}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:border-teal-700"
              >
                <option value="merge">دمج وتحديث السجلات (Merge)</option>
                <option value="replace">استبدال كامل للقاعدة (Replace)</option>
              </select>
              <label className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700 bg-white px-3.5 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-50 cursor-pointer">
                <RotateCcw className="w-3.5 h-3.5" />
                <span>اختيار ملف نسخة احتياطية (.json)</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleSelectRestoreFile}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          {pendingBackup && (
            <div className="rounded-lg border border-teal-200 bg-white p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <p className="font-bold text-slate-900">
                  الملف الجاهز للاستعادة: <span dir="ltr">{pendingBackup.fileName}</span>
                </p>
                <p className="text-slate-600">
                  تاريخ النسخة: <span dir="ltr">{pendingBackup.bundle.exported_at?.slice(0, 19).replace('T', ' ') || '-'}</span> — إجمالي السجلات:{' '}
                  <strong className="font-mono-nums">{pendingBackup.totalRows}</strong> — وضع الاستعادة:{' '}
                  <strong>{restoreMode === 'replace' ? 'استبدال كامل' : 'دمج وتحديث'}</strong>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPendingBackup(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={restoring}
                  onClick={handleExecuteTursoRestore}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-60 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{restoring ? 'جاري الاستعادة إلى Turso...' : 'تنفيذ الاستعادة الآن'}</span>
                </button>
              </div>
            </div>
          )}

          {restoreResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <span>
                  تمت الاستعادة بنجاح ({restoreResult.mode === 'replace' ? 'استبدال كامل' : 'دمج وتحديث'}) — إجمالي السجلات المستعادة:{' '}
                  <strong className="font-mono-nums">{restoreResult.total_restored}</strong>
                </span>
              </div>
              <span className="text-[11px] text-emerald-800" dir="ltr">
                Facilities: {restoreResult.restored_counts.facilities ?? 0} | Depts:{' '}
                {restoreResult.restored_counts.facility_departments ?? 0} | Staff:{' '}
                {restoreResult.restored_counts.facility_staff ?? 0}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-teal-800">
            <Database className="w-4 h-4" />
            <span>المركز المستهدف: {session.active_facility_name}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">أداة الترحيل الذكية الموحدة</h1>
          <p className="mt-1 text-sm text-slate-500">
            قراءة ملفات SQLite (<span dir="ltr">.db</span>) و <span dir="ltr">JSON</span> مباشرة في المتصفح مع واجهة الربط المرئية للجداول وتطبيق الترحيل على مرحلتين.
          </p>
        </div>

        <button
          type="button"
          onClick={handleDownloadSample}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>تنزيل نموذج JSON تجريبي</span>
        </button>
      </div>

      {/* ETL Rules Banner */}
      <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
        <div className="text-xs text-teal-900 space-y-1">
          <p className="font-bold">قواعد الترحيل الآمن ومنع التضارب (2-Phase ETL):</p>
          <p className="text-teal-800 leading-relaxed">
            ١. يتم تجاهل الـ ID القديم كمفتاح أساسي وإعادة توليد UUID جديد لكل سجل مع حفظ الأصل في <span className="font-mono font-semibold">legacy_id</span>.
            ٢. منع التكرار التلقائي في الأقسام والعاملين بناءً على الاسم الكامل أو الكود الوظيفي.
            ٣. التنفيذ التسلسلي: المرحلة الأولى (القيادات والإعدادات والأقسام والعاملين) ثم المرحلة الثانية (سجلات الموديولات وربطها بـ <span className="font-mono font-semibold">facility_id</span>).
          </p>
        </div>
      </div>

      {/* Upload Box */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <span className="block text-xs text-slate-500">المركز الطبي المستهدف (المرتبط بالجلسة الحالية)</span>
            <span className="text-sm font-bold text-slate-900">{session.active_facility_name}</span>
          </div>
          {fileType && (
            <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-1 rounded-lg">
              صيغة الملف: {fileType === 'sqlite' ? 'قاعدة بيانات SQLite (.db)' : 'ملف بيانات JSON'}
            </span>
          )}
        </div>

        <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 hover:bg-teal-50/40 hover:border-teal-600 px-6 py-8 cursor-pointer transition-colors">
          <FileUp className="w-7 h-7 text-teal-700 mb-2" />
          <span className="text-sm font-semibold text-slate-800">
            {parsing
              ? 'جاري تحليل الجداول والأعمدة...'
              : fileName
                ? `الملف المختار: ${fileName}`
                : 'اضغط لرفع ملف قاعدة البيانات (.db / .sqlite) أو ملف JSON'}
          </span>
          <span className="text-xs text-slate-500 mt-1">
            يدعم استخراج كافة الجداول من <span dir="ltr">sqlite_master</span> مباشرة في المتصفح دون رفع الملف الخام قبل المعاينة.
          </span>
          <input
            type="file"
            accept=".db,.sqlite,.sqlite3,.json,application/json,application/x-sqlite3"
            onChange={handleFileUpload}
            className="sr-only"
          />
        </label>

        {parseError && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 flex items-center gap-2 text-sm text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {/* Smart Table Mapping Interface */}
        {detectedTables.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Table2 className="w-4 h-4 text-teal-700" />
                <h2 className="text-sm font-bold text-slate-900">
                  واجهة الربط المرئية للجداول المكتشفة ({detectedTables.length})
                </h2>
              </div>
              <div className="text-xs text-slate-600">
                الجداول المحددة للترحيل: <strong className="font-mono-nums">{activeMappingCount}</strong> — إجمالي الصفوف:{' '}
                <strong className="font-mono-nums">{totalMappedRows}</strong>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs sm:text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="px-4 py-3">اسم الجدول القديم</th>
                      <th className="px-4 py-3">عدد الصفوف</th>
                      <th className="px-4 py-3">الأعمدة المكتشفة</th>
                      <th className="px-4 py-3">الوجهة في القاعدة الموحدة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detectedTables.map((tbl) => {
                      const selectedTarget = tableMappings[tbl.tableName] || 'ignore';
                      return (
                        <tr key={tbl.tableName} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3 font-mono font-bold text-slate-900" dir="ltr">
                            {tbl.tableName}
                          </td>
                          <td className="px-4 py-3 font-mono-nums text-slate-700">{tbl.rowCount}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1 max-w-md" dir="ltr">
                              {tbl.columns.slice(0, 8).map((col) => (
                                <span
                                  key={col}
                                  className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[11px]"
                                >
                                  {col}
                                </span>
                              ))}
                              {tbl.columns.length > 8 && (
                                <span className="text-[11px] text-slate-400">
                                  +{tbl.columns.length - 8}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 min-w-[230px]">
                            <select
                              value={selectedTarget}
                              onChange={(e) =>
                                setTableMappings((prev) => ({
                                  ...prev,
                                  [tbl.tableName]: e.target.value as MigrationTargetDestination,
                                }))
                              }
                              className={`w-full rounded-lg border px-3 py-2 text-xs font-semibold focus:outline-none ${
                                selectedTarget === 'ignore'
                                  ? 'border-slate-200 bg-slate-50 text-slate-500'
                                  : 'border-teal-600 bg-teal-50/40 text-teal-900'
                              }`}
                            >
                              {TARGET_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={migrating || activeMappingCount === 0}
                onClick={handleExecuteMigration}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 transition-colors cursor-pointer"
              >
                <Layers className="w-4 h-4" />
                <span>{migrating ? 'جاري تنفيذ الترحيل على مرحلتين...' : 'تنفيذ الترحيل الموحد'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Result Summary */}
        {lastSummary && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 space-y-3">
            <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5" />
              <span>اكتمل الترحيل المتسلسل على مرحلتين بنجاح</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs text-slate-700">
              <div className="bg-white rounded-lg border border-emerald-100 p-2.5">
                <span className="text-slate-500 block">القيادات:</span>
                <strong className="font-mono-nums text-sm">{lastSummary.leaders_updated}</strong>
              </div>
              <div className="bg-white rounded-lg border border-emerald-100 p-2.5">
                <span className="text-slate-500 block">إعدادات تقارير المرور:</span>
                <strong className="font-mono-nums text-sm">{lastSummary.module_one_settings_updated ?? 0}</strong>
              </div>
              <div className="bg-white rounded-lg border border-emerald-100 p-2.5">
                <span className="text-slate-500 block">إعدادات التدريب:</span>
                <strong className="font-mono-nums text-sm">{lastSummary.module_two_settings_updated ?? 0}</strong>
              </div>
              <div className="bg-white rounded-lg border border-emerald-100 p-2.5">
                <span className="text-slate-500 block">إعدادات غسيل الأيدي:</span>
                <strong className="font-mono-nums text-sm">{lastSummary.module_three_settings_updated ?? 0}</strong>
              </div>
              <div className="bg-white rounded-lg border border-emerald-100 p-2.5">
                <span className="text-slate-500 block">الأقسام:</span>
                <strong className="font-mono-nums text-sm">{lastSummary.departments_upserted}</strong>
              </div>
              <div className="bg-white rounded-lg border border-emerald-100 p-2.5">
                <span className="text-slate-500 block">العاملون:</span>
                <strong className="font-mono-nums text-sm">{lastSummary.staff_upserted}</strong>
              </div>
              <div className="bg-white rounded-lg border border-emerald-100 p-2.5">
                <span className="text-slate-500 block">تقارير المرور:</span>
                <strong className="font-mono-nums text-sm">{lastSummary.module_one_upserted}</strong>
              </div>
              <div className="bg-white rounded-lg border border-emerald-100 p-2.5">
                <span className="text-slate-500 block">التدريب:</span>
                <strong className="font-mono-nums text-sm">{lastSummary.module_two_upserted}</strong>
              </div>
              <div className="bg-white rounded-lg border border-emerald-100 p-2.5">
                <span className="text-slate-500 block">غسيل الأيدي:</span>
                <strong className="font-mono-nums text-sm">{lastSummary.module_three_upserted}</strong>
              </div>
            </div>
            <div className="text-xs text-emerald-800">
              عدد السجلات المكررة التي تم تخطيها / دمجها دون تضارب:{' '}
              <strong className="font-mono-nums">{lastSummary.duplicates_skipped}</strong>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
