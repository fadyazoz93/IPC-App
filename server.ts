import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { db, dbMeta, type DbExecutor } from './db';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const TOKEN_SECRET = crypto
  .createHash('sha256')
  .update('medhub-portal-signing-key-2026')
  .digest('hex');

async function runInTx<T>(execDb: DbExecutor, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  if (execDb !== db) return fn(execDb);
  return db.transaction(fn);
}

// ============================================================================
// 1. UNIFIED DATABASE SCHEMA & COMPOSITE INDEXES (TURSO / LIBSQL ASYNC)
// ============================================================================
async function initializeSchemaAndColumns(): Promise<void> {
  if (!dbMeta.isTursoRemote) {
    try {
      await db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      // ignore on environments where WAL is unsupported
    }
  }
  try {
    await db.exec('PRAGMA foreign_keys = ON;');
  } catch {
    // ignore
  }

  // Preserve any legacy module_one_settings table that used old `settings_json` schema
  try {
    const m1Cols = await db.all<{ name: string }>('PRAGMA table_info(module_one_settings)');
    if (m1Cols.length > 0 && !m1Cols.some((c) => c.name === 'payload')) {
      await db.exec('ALTER TABLE module_one_settings RENAME TO legacy_module_one_settings_tmp');
    }
  } catch {
    // table does not exist yet
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS facilities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      governorate TEXT NOT NULL,
      right_logo_url TEXT NOT NULL DEFAULT '',
      left_logo_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('super_admin', 'facility_staff')),
      facility_id TEXT REFERENCES facilities(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facility_leaders (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL UNIQUE REFERENCES facilities(id) ON DELETE CASCADE,
      hospital_director TEXT NOT NULL,
      quality_director TEXT NOT NULL,
      ic_supervisor TEXT NOT NULL,
      nursing_director TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facility_master_settings (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL UNIQUE REFERENCES facilities(id) ON DELETE CASCADE,
      hospital_director TEXT NOT NULL,
      quality_director TEXT NOT NULL,
      ic_supervisor TEXT NOT NULL,
      nursing_director TEXT NOT NULL,
      logo_url TEXT NOT NULL DEFAULT '',
      module_configs_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_one_settings (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL UNIQUE REFERENCES facilities(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_two_settings (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL UNIQUE REFERENCES facilities(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_three_settings (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL UNIQUE REFERENCES facilities(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facility_departments (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      UNIQUE(facility_id, name)
    );

    CREATE TABLE IF NOT EXISTS facility_staff (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      employee_code TEXT NOT NULL,
      category TEXT NOT NULL,
      department_id TEXT NOT NULL REFERENCES facility_departments(id) ON DELETE CASCADE,
      UNIQUE(facility_id, employee_code)
    );

    CREATE TABLE IF NOT EXISTS module_one_records (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      staff_id TEXT NOT NULL,
      department_id TEXT NOT NULL,
      legacy_id TEXT,
      created_by TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_two_records (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL,
      legacy_id TEXT,
      created_by TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_three_records (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL,
      legacy_id TEXT,
      created_by TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const ensureLegacyIdColumn = async (tableName: string) => {
    const cols = await db.all<{ name: string }>(`PRAGMA table_info(${tableName})`);
    if (!cols.some((c) => c.name === 'legacy_id')) {
      await db.exec(`ALTER TABLE ${tableName} ADD COLUMN legacy_id TEXT`);
    }
  };

  await ensureLegacyIdColumn('module_one_records');
  await ensureLegacyIdColumn('module_two_records');
  await ensureLegacyIdColumn('module_three_records');

  // Migrate existing facilities table to include unified right_logo_url / left_logo_url columns
  try {
    const facCols = await db.all<{ name: string }>('PRAGMA table_info(facilities)');
    if (!facCols.some((c) => c.name === 'right_logo_url')) {
      await db.exec("ALTER TABLE facilities ADD COLUMN right_logo_url TEXT NOT NULL DEFAULT ''");
    }
    if (!facCols.some((c) => c.name === 'left_logo_url')) {
      await db.exec("ALTER TABLE facilities ADD COLUMN left_logo_url TEXT NOT NULL DEFAULT ''");
    }
  } catch {
    // ignore
  }

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_facilities_created ON facilities(created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_users_facility ON users(facility_id);
    CREATE INDEX IF NOT EXISTS idx_users_role_created ON users(role, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_leaders_facility ON facility_leaders(facility_id);
    CREATE INDEX IF NOT EXISTS idx_master_settings_fac ON facility_master_settings(facility_id);
    CREATE INDEX IF NOT EXISTS idx_m1_settings_fac ON module_one_settings(facility_id);
    CREATE INDEX IF NOT EXISTS idx_m2_settings_fac ON module_two_settings(facility_id);
    CREATE INDEX IF NOT EXISTS idx_m3_settings_fac ON module_three_settings(facility_id);
    CREATE INDEX IF NOT EXISTS idx_departments_facility ON facility_departments(facility_id);
    CREATE INDEX IF NOT EXISTS idx_staff_facility ON facility_staff(facility_id);
    CREATE INDEX IF NOT EXISTS idx_staff_fac_name ON facility_staff(facility_id, name ASC);
    CREATE INDEX IF NOT EXISTS idx_staff_fac_dept ON facility_staff(facility_id, department_id);
    CREATE INDEX IF NOT EXISTS idx_m1_fac_created ON module_one_records(facility_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_m1_fac_status ON module_one_records(facility_id, status);
    CREATE INDEX IF NOT EXISTS idx_m2_fac_created ON module_two_records(facility_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_m2_fac_status_created ON module_two_records(facility_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_m3_fac_created ON module_three_records(facility_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_m3_fac_status_created ON module_three_records(facility_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_m1_fac_legacy ON module_one_records(facility_id, legacy_id);
    CREATE INDEX IF NOT EXISTS idx_m2_fac_legacy ON module_two_records(facility_id, legacy_id);
    CREATE INDEX IF NOT EXISTS idx_m3_fac_legacy ON module_three_records(facility_id, legacy_id);
  `);

  // Expression indexes for case-insensitive lookups and JSON dashboard/session filters
  try {
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_facilities_upper_code ON facilities(upper(code));
      CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users(lower(email));
      CREATE INDEX IF NOT EXISTS idx_staff_fac_upper_code ON facility_staff(facility_id, upper(employee_code));
      CREATE INDEX IF NOT EXISTS idx_m1_fac_report_type_status ON module_one_records(facility_id, json_extract(payload, '$.report_type'), status);
      CREATE INDEX IF NOT EXISTS idx_m3_fac_hh_session ON module_three_records(facility_id, status, json_extract(payload, '$.sessionInfo.sessionId'));
    `);
  } catch {
    // Fallback if older SQLite build does not support expression indexes
  }
}

// ============================================================================
// 2. AUTHENTICATION HELPERS
// ============================================================================
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

interface TokenPayload {
  uid: string;
  role: 'super_admin' | 'facility_staff';
  facility_id: string | null;
  exp: number;
}

function signToken(payload: TokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): TokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  if (sig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  try {
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

// ============================================================================
// 3. UNIFIED MASTER SETTINGS & MODULE CONFIGS
// ============================================================================
interface ReportProcedureConfig {
  name: string;
  note: string;
  rec: string;
  depts: string[];
}

interface ModuleConfigsJson {
  shared: {
    hospital_name: string;
    right_logo_url: string;
    left_logo_url: string;
  };
  reports: {
    periods: string[];
    procedures: ReportProcedureConfig[];
  };
  training: {
    categories: string[];
    policies: string[];
    trainers: string[];
    ic_manager_title: string;
    hospital_manager_title: string;
  };
  hand_hygiene: {
    header1: string;
    header2: string;
    header3: string;
    services: string[];
    wards: string[];
    cities: string[];
    profCategories: string[];
    observers: string[];
  };
}

interface FacilityMasterSettingsRow {
  id: string;
  facility_id: string;
  hospital_director: string;
  quality_director: string;
  ic_supervisor: string;
  nursing_director: string;
  logo_url: string;
  module_configs_json: string;
  updated_at: string;
}

const DEFAULT_REPORT_PROCEDURES: ReportProcedureConfig[] = [
  {
    name: 'الالتزام بغسل الأيدي وتطهيرها قبل وبعد التعامل مع المريض',
    note: 'عدم توافر مطهر كحولي أو عدم الالتزام باللحظات الخمس لغسل الأيدي',
    rec: 'توفير مطهرات كحولية بجميع نقاط الرعاية وتنفيذ التذكير الدوري للطاقم',
    depts: [],
  },
  {
    name: 'ارتداء مهمات الوقاية الشخصية المناسبة (PPE)',
    note: 'عدم ارتداء الواقيات الشخصية المقررة أو استخدامها بشكل غير سليم',
    rec: 'الالتزام بسياسة مهمات الوقاية الشخصية وتوفير المقاسات المطلوبة بالقسم',
    depts: [],
  },
  {
    name: 'الفصل السليم للنفايات الطبية الخطرة وصناديق الأمان',
    note: 'اختلاط النفايات الطبية بالعادية أو امتلاء صندوق الأمان لأكثر من 3/4 السعة',
    rec: 'إعادة الفرز الآمن وإغلاق صناديق الأمان عند 3/4 السعة وتدريب الخدمات المعاونة',
    depts: [],
  },
  {
    name: 'نظافة وتطهير الأسطح البيئية عالية اللمس',
    note: 'عدم استكمال جدول تطهير الأسطح والمعدات الطبية بين المرضى',
    rec: 'تفعيل قائمة التحقق الدورية للتطهير ومراجعتها مع مشرف القسم بكل نوبتجية',
    depts: [],
  },
  {
    name: 'الحفظ الآمن للآلات المعقمة ومستلزمات الغيار',
    note: 'تخزين عبوات معقمة في أماكن رطبة أو بدون تاريخ انتهاء صلاحية التعقيم واضح',
    rec: 'الالتزام بشروط التخزين المعقم (نظام الوارد أولاً يصرف أولاً)',
    depts: [],
  },
];

const DEFAULT_TRAINING_POLICIES = [
  'سياسة غسل الأيدي',
  'سياسة مهمات الوقاية الشخصية (PPE)',
  'سياسة إدارة النفايات الطبية الخطرة',
  'سياسة التعقيم والتطهير',
  'سياسة التعامل مع الوخز بالإبر',
];

function mapStaffCategoryToTrainingCategory(cat: string): string {
  const clean = String(cat || '').trim();
  if (clean === 'طبيب') return 'أطباء';
  if (clean === 'إداري') return 'إداريين';
  if (clean === 'تمريض') return 'تمريض';
  if (clean === 'خدمات معاونة') return 'خدمات معاونة';
  return clean || 'تمريض';
}

function buildDefaultModuleConfigs(
  facilityName: string,
  governorate: string,
  icSupervisor: string,
  nursingDirector: string,
  staffNames: string[]
): ModuleConfigsJson {
  const trainers = Array.from(
    new Set(
      [
        icSupervisor && icSupervisor !== 'غير محدد' ? icSupervisor : 'مشرف مكافحة العدوى',
        nursingDirector && nursingDirector !== 'غير محدد' ? nursingDirector : 'رئيس هيئة التمريض',
      ].filter(Boolean)
    )
  );
  const observers = Array.from(
    new Set(
      [
        ...(icSupervisor && icSupervisor !== 'غير محدد' ? [icSupervisor] : []),
        ...(nursingDirector && nursingDirector !== 'غير محدد' ? [nursingDirector] : []),
        ...staffNames,
      ].filter(Boolean)
    )
  );

  return {
    shared: {
      hospital_name: facilityName || 'المركز الطبي',
      right_logo_url: '',
      left_logo_url: '',
    },
    reports: {
      periods: ['صباحي', 'مسائي', 'ليلي'],
      procedures: DEFAULT_REPORT_PROCEDURES,
    },
    training: {
      categories: ['تمريض', 'أطباء', 'خدمات معاونة', 'إداريين'],
      policies: DEFAULT_TRAINING_POLICIES,
      trainers,
      ic_manager_title: 'مدير مكافحة العدوى',
      hospital_manager_title: 'مدير عام المستشفى',
    },
    hand_hygiene: {
      header1: facilityName || 'المركز الطبي',
      header2: 'وحدة مكافحة العدوى',
      header3: 'إحصائية غسيل الأيدي',
      services: ['داخلي', 'عيادات خارجية', 'طوارئ', 'عمليات'],
      wards: ['الدور الأرضي', 'الدور الأول', 'الدور الثاني'],
      cities: governorate && governorate !== 'عام' ? [governorate] : ['القاهرة'],
      profCategories: ['أطباء', 'تمريض', 'مساعد تمريض', 'عمال'],
      observers,
    },
  };
}

function normalizeModuleConfigs(
  raw: unknown,
  fallback: ModuleConfigsJson
): ModuleConfigsJson {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<ModuleConfigsJson>) : {};
  return {
    shared: {
      hospital_name: obj.shared?.hospital_name || fallback.shared.hospital_name,
      right_logo_url: obj.shared?.right_logo_url ?? fallback.shared.right_logo_url,
      left_logo_url: obj.shared?.left_logo_url ?? fallback.shared.left_logo_url,
    },
    reports: {
      periods:
        Array.isArray(obj.reports?.periods) && obj.reports.periods.length > 0
          ? obj.reports.periods
          : fallback.reports.periods,
      procedures:
        Array.isArray(obj.reports?.procedures) && obj.reports.procedures.length > 0
          ? obj.reports.procedures
          : fallback.reports.procedures,
    },
    training: {
      categories:
        Array.isArray(obj.training?.categories) && obj.training.categories.length > 0
          ? obj.training.categories
          : fallback.training.categories,
      policies:
        Array.isArray(obj.training?.policies) && obj.training.policies.length > 0
          ? obj.training.policies
          : fallback.training.policies,
      trainers:
        Array.isArray(obj.training?.trainers) && obj.training.trainers.length > 0
          ? obj.training.trainers
          : fallback.training.trainers,
      ic_manager_title: obj.training?.ic_manager_title || fallback.training.ic_manager_title,
      hospital_manager_title:
        obj.training?.hospital_manager_title || fallback.training.hospital_manager_title,
    },
    hand_hygiene: {
      header1: obj.hand_hygiene?.header1 || fallback.hand_hygiene.header1,
      header2: obj.hand_hygiene?.header2 || fallback.hand_hygiene.header2,
      header3: obj.hand_hygiene?.header3 || fallback.hand_hygiene.header3,
      services:
        Array.isArray(obj.hand_hygiene?.services) && obj.hand_hygiene.services.length > 0
          ? obj.hand_hygiene.services
          : fallback.hand_hygiene.services,
      wards:
        Array.isArray(obj.hand_hygiene?.wards) && obj.hand_hygiene.wards.length > 0
          ? obj.hand_hygiene.wards
          : fallback.hand_hygiene.wards,
      cities:
        Array.isArray(obj.hand_hygiene?.cities) && obj.hand_hygiene.cities.length > 0
          ? obj.hand_hygiene.cities
          : fallback.hand_hygiene.cities,
      profCategories:
        Array.isArray(obj.hand_hygiene?.profCategories) &&
        obj.hand_hygiene.profCategories.length > 0
          ? obj.hand_hygiene.profCategories
          : fallback.hand_hygiene.profCategories,
      observers:
        Array.isArray(obj.hand_hygiene?.observers) && obj.hand_hygiene.observers.length > 0
          ? obj.hand_hygiene.observers
          : fallback.hand_hygiene.observers,
    },
  };
}

async function getOrCreateMasterSettings(facilityId: string, execDb: DbExecutor = db) {
  const facility = await execDb.get<{ id: string; name: string; governorate: string }>(
    'SELECT id, name, governorate FROM facilities WHERE id = ?',
    [facilityId]
  );
  const legacyLeader = await execDb.get<{
    hospital_director: string;
    quality_director: string;
    ic_supervisor: string;
    nursing_director: string;
  }>(
    'SELECT hospital_director, quality_director, ic_supervisor, nursing_director FROM facility_leaders WHERE facility_id = ?',
    [facilityId]
  );
  const staff = await execDb.all<{ name: string }>(
    'SELECT name FROM facility_staff WHERE facility_id = ? ORDER BY name ASC',
    [facilityId]
  );

  const fallbackConfigs = buildDefaultModuleConfigs(
    facility?.name || 'المركز الطبي',
    facility?.governorate || 'عام',
    legacyLeader?.ic_supervisor || 'غير محدد',
    legacyLeader?.nursing_director || 'غير محدد',
    staff.map((s) => s.name)
  );

  const row = await execDb.get<FacilityMasterSettingsRow>(
    'SELECT * FROM facility_master_settings WHERE facility_id = ?',
    [facilityId]
  );

  if (row) {
    let parsedConfigs = fallbackConfigs;
    try {
      parsedConfigs = normalizeModuleConfigs(JSON.parse(row.module_configs_json), fallbackConfigs);
    } catch {
      parsedConfigs = fallbackConfigs;
    }
    return {
      id: row.id,
      facility_id: row.facility_id,
      hospital_director: row.hospital_director,
      quality_director: row.quality_director,
      ic_supervisor: row.ic_supervisor,
      nursing_director: row.nursing_director,
      logo_url: row.logo_url || '',
      module_configs: parsedConfigs,
      updated_at: row.updated_at,
    };
  }

  const now = new Date().toISOString();
  const id = `mst-${facilityId}`;
  const hospDir = legacyLeader?.hospital_director || 'غير محدد';
  const qualDir = legacyLeader?.quality_director || 'غير محدد';
  const icSup = legacyLeader?.ic_supervisor || 'غير محدد';
  const nurDir = legacyLeader?.nursing_director || 'غير محدد';

  await execDb.run(
    `INSERT INTO facility_master_settings
       (id, facility_id, hospital_director, quality_director, ic_supervisor, nursing_director, logo_url, module_configs_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      facilityId,
      hospDir,
      qualDir,
      icSup,
      nurDir,
      '',
      JSON.stringify(fallbackConfigs),
      now,
    ]
  );

  return {
    id,
    facility_id: facilityId,
    hospital_director: hospDir,
    quality_director: qualDir,
    ic_supervisor: icSup,
    nursing_director: nurDir,
    logo_url: '',
    module_configs: fallbackConfigs,
    updated_at: now,
  };
}

async function saveMasterSettings(
  facilityId: string,
  patch: {
    hospital_director?: string;
    quality_director?: string;
    ic_supervisor?: string;
    nursing_director?: string;
    logo_url?: string;
    module_configs?: Partial<ModuleConfigsJson>;
  },
  execDb: DbExecutor = db
) {
  const current = await getOrCreateMasterSettings(facilityId, execDb);
  const nextHosp = patch.hospital_director?.trim() || current.hospital_director || 'غير محدد';
  const nextQual = patch.quality_director?.trim() || current.quality_director || 'غير محدد';
  const nextIc = patch.ic_supervisor?.trim() || current.ic_supervisor || 'غير محدد';
  const nextNur = patch.nursing_director?.trim() || current.nursing_director || 'غير محدد';
  const nextLogo = patch.logo_url !== undefined ? patch.logo_url.trim() : current.logo_url;
  const mergedConfigs = normalizeModuleConfigs(
    {
      shared: { ...current.module_configs.shared, ...(patch.module_configs?.shared || {}) },
      reports: { ...current.module_configs.reports, ...(patch.module_configs?.reports || {}) },
      training: { ...current.module_configs.training, ...(patch.module_configs?.training || {}) },
      hand_hygiene: {
        ...current.module_configs.hand_hygiene,
        ...(patch.module_configs?.hand_hygiene || {}),
      },
    },
    current.module_configs
  );
  if (nextLogo && !mergedConfigs.shared.right_logo_url) {
    mergedConfigs.shared.right_logo_url = nextLogo;
  }
  const effectiveLogo = nextLogo || mergedConfigs.shared.right_logo_url || '';
  const now = new Date().toISOString();

  await runInTx(execDb, async (tx) => {
    await tx.run(
      `INSERT INTO facility_master_settings
         (id, facility_id, hospital_director, quality_director, ic_supervisor, nursing_director, logo_url, module_configs_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(facility_id) DO UPDATE SET
         hospital_director = excluded.hospital_director,
         quality_director = excluded.quality_director,
         ic_supervisor = excluded.ic_supervisor,
         nursing_director = excluded.nursing_director,
         logo_url = excluded.logo_url,
         module_configs_json = excluded.module_configs_json,
         updated_at = excluded.updated_at`,
      [
        current.id,
        facilityId,
        nextHosp,
        nextQual,
        nextIc,
        nextNur,
        effectiveLogo,
        JSON.stringify(mergedConfigs),
        now,
      ]
    );

    await tx.run(
      `INSERT INTO facility_leaders (id, facility_id, hospital_director, quality_director, ic_supervisor, nursing_director)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(facility_id) DO UPDATE SET
         hospital_director = excluded.hospital_director,
         quality_director = excluded.quality_director,
         ic_supervisor = excluded.ic_supervisor,
         nursing_director = excluded.nursing_director`,
      [`ldr-${facilityId}`, facilityId, nextHosp, nextQual, nextIc, nextNur]
    );
  });

  return getOrCreateMasterSettings(facilityId, execDb);
}

// ============================================================================
// 3B. ISOLATED PER-MODULE SETTINGS TABLES (STRICT WHERE facility_id = ?)
// ============================================================================
interface ModuleOneSettingsPayload {
  hospitalName: string;
  teamSignature: string;
  managerSignature: string;
  rightLogoUrl: string;
  leftLogoUrl: string;
  departments: string[];
  periods: string[];
  inspectors: string[];
  implementers: string[];
  procedures: ReportProcedureConfig[];
}

interface ModuleTwoSettingsPayload {
  settings: Array<{ ID?: string | number; Type: string; Value: string }>;
  categories: string[];
  employees?: Array<{ ID: string; Name: string; Job?: string; Category: string }>;
}

interface ModuleThreeSettingsPayload {
  header1: string;
  header2: string;
  header3: string;
  logoRight: string;
  logoLeft: string;
  facilities: string[];
  services: string[];
  wards: string[];
  departments: string[];
  observers: string[];
  cities: string[];
  profCategories: string[];
}

async function getFacilityHeaderInfo(
  facilityId: string,
  execDb: DbExecutor = db
): Promise<{
  name: string;
  rightLogoUrl: string;
  leftLogoUrl: string;
}> {
  const row = await execDb.get<{
    name?: string;
    right_logo_url?: string;
    left_logo_url?: string;
  }>('SELECT name, right_logo_url, left_logo_url FROM facilities WHERE id = ?', [facilityId]);
  return {
    name: String(row?.name || '').trim() || 'المركز الطبي',
    rightLogoUrl: String(row?.right_logo_url || '').trim(),
    leftLogoUrl: String(row?.left_logo_url || '').trim(),
  };
}

async function buildDefaultModuleOneSettings(
  facilityId: string,
  execDb: DbExecutor = db
): Promise<ModuleOneSettingsPayload> {
  const master = await getOrCreateMasterSettings(facilityId, execDb);
  const depts = (
    await execDb.all<{ name: string }>(
      'SELECT name FROM facility_departments WHERE facility_id = ? ORDER BY name ASC',
      [facilityId]
    )
  ).map((d) => d.name);
  const staff = (
    await execDb.all<{ name: string }>(
      'SELECT name FROM facility_staff WHERE facility_id = ? ORDER BY name ASC',
      [facilityId]
    )
  ).map((s) => s.name);

  const sc = master.module_configs.shared;
  const rc = master.module_configs.reports;
  const facInfo = await getFacilityHeaderInfo(facilityId, execDb);

  return {
    hospitalName: facInfo.name,
    teamSignature:
      master.ic_supervisor && master.ic_supervisor !== 'غير محدد'
        ? master.ic_supervisor
        : 'مشرف مكافحة العدوى',
    managerSignature:
      master.hospital_director && master.hospital_director !== 'غير محدد'
        ? master.hospital_director
        : 'مدير عام المستشفى',
    rightLogoUrl: facInfo.rightLogoUrl || sc.right_logo_url || master.logo_url || '',
    leftLogoUrl: facInfo.leftLogoUrl || sc.left_logo_url || '',
    departments: depts,
    periods: rc.periods?.length ? rc.periods : ['صباحي', 'مسائي', 'ليلي'],
    inspectors: staff,
    implementers: staff,
    procedures: rc.procedures?.length ? rc.procedures : DEFAULT_REPORT_PROCEDURES,
  };
}

async function getOrCreateModuleOneSettings(
  facilityId: string,
  execDb: DbExecutor = db
): Promise<ModuleOneSettingsPayload> {
  const row = await execDb.get<{ payload: string }>(
    'SELECT payload FROM module_one_settings WHERE facility_id = ?',
    [facilityId]
  );
  const facInfo = await getFacilityHeaderInfo(facilityId, execDb);

  if (row) {
    try {
      const parsed = JSON.parse(row.payload) as Partial<ModuleOneSettingsPayload>;
      const fallback = await buildDefaultModuleOneSettings(facilityId, execDb);
      return {
        hospitalName: facInfo.name,
        teamSignature: parsed.teamSignature ?? fallback.teamSignature,
        managerSignature: parsed.managerSignature ?? fallback.managerSignature,
        rightLogoUrl: facInfo.rightLogoUrl,
        leftLogoUrl: facInfo.leftLogoUrl,
        departments: Array.isArray(parsed.departments) ? parsed.departments : fallback.departments,
        periods: Array.isArray(parsed.periods) ? parsed.periods : fallback.periods,
        inspectors: Array.isArray(parsed.inspectors) ? parsed.inspectors : fallback.inspectors,
        implementers: Array.isArray(parsed.implementers) ? parsed.implementers : fallback.implementers,
        procedures: Array.isArray(parsed.procedures) ? parsed.procedures : fallback.procedures,
      };
    } catch {
      // fall through and recreate
    }
  }

  const initial = await buildDefaultModuleOneSettings(facilityId, execDb);
  const now = new Date().toISOString();
  await execDb.run(
    `INSERT INTO module_one_settings (id, facility_id, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(facility_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    [`m1set-${facilityId}`, facilityId, JSON.stringify(initial), now]
  );
  return initial;
}

async function saveModuleOneSettings(
  facilityId: string,
  next: Partial<ModuleOneSettingsPayload>,
  execDb: DbExecutor = db
): Promise<ModuleOneSettingsPayload> {
  const current = await getOrCreateModuleOneSettings(facilityId, execDb);
  const facInfo = await getFacilityHeaderInfo(facilityId, execDb);
  const merged: ModuleOneSettingsPayload = {
    hospitalName: facInfo.name,
    teamSignature:
      next.teamSignature !== undefined ? String(next.teamSignature) : current.teamSignature,
    managerSignature:
      next.managerSignature !== undefined ? String(next.managerSignature) : current.managerSignature,
    rightLogoUrl: facInfo.rightLogoUrl,
    leftLogoUrl: facInfo.leftLogoUrl,
    departments: Array.isArray(next.departments) ? next.departments : current.departments,
    periods: Array.isArray(next.periods) ? next.periods : current.periods,
    inspectors: Array.isArray(next.inspectors) ? next.inspectors : current.inspectors,
    implementers: Array.isArray(next.implementers) ? next.implementers : current.implementers,
    procedures: Array.isArray(next.procedures) ? next.procedures : current.procedures,
  };
  const now = new Date().toISOString();
  await execDb.run(
    `INSERT INTO module_one_settings (id, facility_id, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(facility_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    [`m1set-${facilityId}`, facilityId, JSON.stringify(merged), now]
  );
  return merged;
}

async function buildDefaultModuleTwoSettings(
  facilityId: string,
  execDb: DbExecutor = db
): Promise<ModuleTwoSettingsPayload> {
  const master = await getOrCreateMasterSettings(facilityId, execDb);
  const depts = await execDb.all<{ id: string; name: string }>(
    'SELECT id, name FROM facility_departments WHERE facility_id = ?',
    [facilityId]
  );
  const staff = await execDb.all<{
    id: string;
    name: string;
    employee_code: string;
    category: string;
    department_id: string;
  }>(
    'SELECT id, name, employee_code, category, department_id FROM facility_staff WHERE facility_id = ? ORDER BY name ASC',
    [facilityId]
  );

  const deptNameMap = new Map(depts.map((d) => [d.id, d.name]));
  const employees = staff.map((s) => ({
    ID: s.employee_code || s.id,
    Name: s.name,
    Job: deptNameMap.get(s.department_id) || s.category,
    Category: mapStaffCategoryToTrainingCategory(s.category),
  }));

  const tc = master.module_configs.training;
  const sc = master.module_configs.shared;
  const facInfo = await getFacilityHeaderInfo(facilityId, execDb);
  const categories = Array.from(
    new Set([...(tc.categories || []), ...employees.map((e) => e.Category).filter(Boolean)])
  );

  const settings: Array<{ ID?: string | number; Type: string; Value: string }> = [
    { ID: 'set-hosp-name', Type: 'Hospital_Name', Value: facInfo.name },
    { ID: 'set-hosp-logo', Type: 'Hospital_Logo', Value: facInfo.rightLogoUrl || sc.right_logo_url || master.logo_url || '' },
    { ID: 'set-hosp-logo-left', Type: 'Hospital_Logo_Left', Value: facInfo.leftLogoUrl || sc.left_logo_url || '' },
    { ID: 'set-ic-title', Type: 'IC_Manager_Title', Value: tc.ic_manager_title || 'مدير مكافحة العدوى' },
    {
      ID: 'set-ic-name',
      Type: 'IC_Manager_Name',
      Value: master.ic_supervisor !== 'غير محدد' ? master.ic_supervisor : 'مشرف مكافحة العدوى',
    },
    { ID: 'set-hm-title', Type: 'Hospital_Manager_Title', Value: tc.hospital_manager_title || 'مدير عام المستشفى' },
    {
      ID: 'set-hm-name',
      Type: 'Hospital_Manager_Name',
      Value: master.hospital_director !== 'غير محدد' ? master.hospital_director : 'مدير عام المستشفى',
    },
    ...categories.map((c, idx) => ({ ID: `set-cat-${idx}`, Type: 'Category', Value: c })),
    ...(tc.policies || []).map((p, idx) => ({ ID: `set-pol-${idx}`, Type: 'Policy', Value: p })),
    ...(tc.trainers || []).map((t, idx) => ({ ID: `set-trn-${idx}`, Type: 'Trainer', Value: t })),
  ];

  return { settings, categories, employees };
}

async function syncUnifiedFacilityIntoModuleTwoSettings(
  facilityId: string,
  list: Array<{ ID?: string | number; Type: string; Value: string }>,
  execDb: DbExecutor = db
): Promise<Array<{ ID?: string | number; Type: string; Value: string }>> {
  const facInfo = await getFacilityHeaderInfo(facilityId, execDb);
  const filtered = list.filter(
    (s) =>
      s.Type !== 'Hospital_Name' &&
      s.Type !== 'Hospital_Logo' &&
      s.Type !== 'Hospital_Logo_Left'
  );
  return [
    ...filtered,
    { ID: 'set-hosp-name', Type: 'Hospital_Name', Value: facInfo.name },
    { ID: 'set-hosp-logo', Type: 'Hospital_Logo', Value: facInfo.rightLogoUrl },
    { ID: 'set-hosp-logo-left', Type: 'Hospital_Logo_Left', Value: facInfo.leftLogoUrl },
  ];
}

async function getOrCreateModuleTwoSettings(
  facilityId: string,
  execDb: DbExecutor = db
): Promise<ModuleTwoSettingsPayload> {
  const row = await execDb.get<{ payload: string }>(
    'SELECT payload FROM module_two_settings WHERE facility_id = ?',
    [facilityId]
  );

  if (row) {
    try {
      const parsed = JSON.parse(row.payload) as Partial<ModuleTwoSettingsPayload>;
      const fallback = await buildDefaultModuleTwoSettings(facilityId, execDb);
      const rawSettings = Array.isArray(parsed.settings) ? parsed.settings : fallback.settings;
      const settings = await syncUnifiedFacilityIntoModuleTwoSettings(facilityId, rawSettings, execDb);
      const categoriesFromSettings = settings
        .filter((s) => s.Type === 'Category' && s.Value)
        .map((s) => String(s.Value).trim());
      const categories =
        Array.isArray(parsed.categories) && parsed.categories.length > 0
          ? Array.from(new Set([...parsed.categories, ...categoriesFromSettings].filter(Boolean)))
          : categoriesFromSettings.length > 0
            ? categoriesFromSettings
            : fallback.categories;
      return {
        settings,
        categories,
        employees: Array.isArray(parsed.employees) ? parsed.employees : fallback.employees,
      };
    } catch {
      // recreate
    }
  }

  const initial = await buildDefaultModuleTwoSettings(facilityId, execDb);
  const now = new Date().toISOString();
  await execDb.run(
    `INSERT INTO module_two_settings (id, facility_id, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(facility_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    [`m2set-${facilityId}`, facilityId, JSON.stringify(initial), now]
  );
  return initial;
}

async function saveModuleTwoSettings(
  facilityId: string,
  next: Partial<ModuleTwoSettingsPayload>,
  execDb: DbExecutor = db
): Promise<ModuleTwoSettingsPayload> {
  const current = await getOrCreateModuleTwoSettings(facilityId, execDb);
  const rawSettings = Array.isArray(next.settings) ? next.settings : current.settings;
  const settings = await syncUnifiedFacilityIntoModuleTwoSettings(facilityId, rawSettings, execDb);
  const employees = Array.isArray(next.employees) ? next.employees : current.employees;
  const categories = Array.isArray(next.categories)
    ? next.categories
    : Array.from(
        new Set([
          ...current.categories,
          ...settings.filter((s) => s.Type === 'Category' && s.Value).map((s) => s.Value),
        ])
      );
  const merged: ModuleTwoSettingsPayload = { settings, categories, employees };
  const now = new Date().toISOString();
  await execDb.run(
    `INSERT INTO module_two_settings (id, facility_id, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(facility_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    [`m2set-${facilityId}`, facilityId, JSON.stringify(merged), now]
  );
  return merged;
}

async function buildDefaultModuleThreeSettings(
  facilityId: string,
  execDb: DbExecutor = db
): Promise<ModuleThreeSettingsPayload> {
  const master = await getOrCreateMasterSettings(facilityId, execDb);
  const depts = (
    await execDb.all<{ name: string }>(
      'SELECT name FROM facility_departments WHERE facility_id = ? ORDER BY name ASC',
      [facilityId]
    )
  ).map((d) => d.name);

  const cfg = master.module_configs;
  const hh = cfg.hand_hygiene;
  const sc = cfg.shared;
  const facInfo = await getFacilityHeaderInfo(facilityId, execDb);
  const deptNames = Array.from(new Set([...depts, ...(hh.wards || [])].filter(Boolean)));
  const resolvedHeader2 =
    hh.header2 && hh.header2 !== facInfo.name ? hh.header2 : 'وحدة مكافحة العدوى';

  return {
    header1: facInfo.name,
    header2: resolvedHeader2,
    header3: hh.header3 || 'إحصائية غسيل الأيدي',
    logoRight: facInfo.rightLogoUrl || sc.right_logo_url || master.logo_url || '',
    logoLeft: facInfo.leftLogoUrl || sc.left_logo_url || '',
    facilities: facInfo.name ? [facInfo.name] : [],
    services: hh.services || [],
    wards: hh.wards || [],
    departments: deptNames,
    observers: hh.observers || [],
    cities: hh.cities || [],
    profCategories: hh.profCategories || ['أطباء', 'تمريض', 'مساعد تمريض', 'عمال'],
  };
}

async function getOrCreateModuleThreeSettings(
  facilityId: string,
  execDb: DbExecutor = db
): Promise<ModuleThreeSettingsPayload> {
  const row = await execDb.get<{ payload: string }>(
    'SELECT payload FROM module_three_settings WHERE facility_id = ?',
    [facilityId]
  );
  const facInfo = await getFacilityHeaderInfo(facilityId, execDb);

  if (row) {
    try {
      const parsed = JSON.parse(row.payload) as Partial<ModuleThreeSettingsPayload>;
      const fallback = await buildDefaultModuleThreeSettings(facilityId, execDb);
      const parsedHeader2 =
        parsed.header2 && parsed.header2 !== facInfo.name ? parsed.header2 : fallback.header2;
      return {
        header1: facInfo.name,
        header2: parsedHeader2,
        header3: parsed.header3 ?? fallback.header3,
        logoRight: facInfo.rightLogoUrl,
        logoLeft: facInfo.leftLogoUrl,
        facilities: facInfo.name ? [facInfo.name] : fallback.facilities,
        services: Array.isArray(parsed.services) ? parsed.services : fallback.services,
        wards: Array.isArray(parsed.wards) ? parsed.wards : fallback.wards,
        departments: Array.isArray(parsed.departments) ? parsed.departments : fallback.departments,
        observers: Array.isArray(parsed.observers) ? parsed.observers : fallback.observers,
        cities: Array.isArray(parsed.cities) ? parsed.cities : fallback.cities,
        profCategories: Array.isArray(parsed.profCategories)
          ? parsed.profCategories
          : fallback.profCategories,
      };
    } catch {
      // recreate
    }
  }

  const initial = await buildDefaultModuleThreeSettings(facilityId, execDb);
  const now = new Date().toISOString();
  await execDb.run(
    `INSERT INTO module_three_settings (id, facility_id, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(facility_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    [`m3set-${facilityId}`, facilityId, JSON.stringify(initial), now]
  );
  return initial;
}

async function saveModuleThreeSettings(
  facilityId: string,
  next: Partial<ModuleThreeSettingsPayload>,
  execDb: DbExecutor = db
): Promise<ModuleThreeSettingsPayload> {
  const current = await getOrCreateModuleThreeSettings(facilityId, execDb);
  const facInfo = await getFacilityHeaderInfo(facilityId, execDb);
  const merged: ModuleThreeSettingsPayload = {
    header1: facInfo.name,
    header2: next.header2 !== undefined ? String(next.header2) : current.header2,
    header3: next.header3 !== undefined ? String(next.header3) : current.header3,
    logoRight: facInfo.rightLogoUrl,
    logoLeft: facInfo.leftLogoUrl,
    facilities: facInfo.name ? [facInfo.name] : current.facilities,
    services: Array.isArray(next.services) ? next.services : current.services,
    wards: Array.isArray(next.wards) ? next.wards : current.wards,
    departments: Array.isArray(next.departments) ? next.departments : current.departments,
    observers: Array.isArray(next.observers) ? next.observers : current.observers,
    cities: Array.isArray(next.cities) ? next.cities : current.cities,
    profCategories: Array.isArray(next.profCategories)
      ? next.profCategories
      : current.profCategories,
  };
  const now = new Date().toISOString();
  await execDb.run(
    `INSERT INTO module_three_settings (id, facility_id, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(facility_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    [`m3set-${facilityId}`, facilityId, JSON.stringify(merged), now]
  );
  return merged;
}

// ============================================================================
// 4. INITIAL SEEDING & STARTUP CONSOLIDATION INTO UNIFIED TABLES
// ============================================================================
async function seedInitialData() {
  const countRow = await db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM facilities');
  const existingCount = Number(countRow?.cnt || 0);
  if (existingCount > 0) return;

  const now = '2026-11-01T08:00:00.000Z';
  const insertFacilitySql = 'INSERT INTO facilities (id, name, code, governorate, created_at) VALUES (?, ?, ?, ?, ?)';
  const insertUserSql = 'INSERT INTO users (id, name, email, password_hash, role, facility_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)';
  const insertLeaderSql = 'INSERT INTO facility_leaders (id, facility_id, hospital_director, quality_director, ic_supervisor, nursing_director) VALUES (?, ?, ?, ?, ?, ?)';
  const insertDeptSql = 'INSERT INTO facility_departments (id, facility_id, name, type) VALUES (?, ?, ?, ?)';
  const insertStaffSql = 'INSERT INTO facility_staff (id, facility_id, name, employee_code, category, department_id) VALUES (?, ?, ?, ?, ?, ?)';

  await db.transaction(async (tx) => {
    await tx.run(insertFacilitySql, ['fac-cairo-01', 'مستشفى النور التخصصي', 'NOR-01', 'القاهرة', now]);
    await tx.run(insertFacilitySql, ['fac-alex-02', 'مركز الشفاء الطبي المتكامل', 'SHF-02', 'الإسكندرية', now]);

    await tx.run(insertUserSql, [
      'usr-admin-01',
      'د. أحمد منصور الشريف',
      'admin@medhub.gov',
      hashPassword('Admin@1234'),
      'super_admin',
      null,
      now,
    ]);
    await tx.run(insertUserSql, [
      'usr-noor-01',
      'أ. سارة عبد الرحمن',
      'noor.staff@medhub.gov',
      hashPassword('Staff@1234'),
      'facility_staff',
      'fac-cairo-01',
      now,
    ]);
    await tx.run(insertUserSql, [
      'usr-shifa-01',
      'أ. طارق محمود حسنين',
      'shifa.staff@medhub.gov',
      hashPassword('Staff@1234'),
      'facility_staff',
      'fac-alex-02',
      now,
    ]);

    await tx.run(insertLeaderSql, [
      'ldr-fac-cairo-01',
      'fac-cairo-01',
      'أ.د. خالد عبد العزيز',
      'د. منى السيد رضوان',
      'د. هيثم فؤاد مصطفى',
      'أ. فاطمة حسن النجار',
    ]);

    const noorDepts = [
      ['dep-noor-or', 'fac-cairo-01', 'جناح العمليات الكبرى', 'طوارئ وعمليات'],
      ['dep-noor-cssd', 'fac-cairo-01', 'التعقيم المركزي (CSSD)', 'معاون وخدمي'],
      ['dep-noor-icu', 'fac-cairo-01', 'الرعاية المركزة', 'إكلينيكي'],
      ['dep-noor-er', 'fac-cairo-01', 'الطوارئ والاستقبال', 'طوارئ وعمليات'],
      ['dep-noor-opd', 'fac-cairo-01', 'العيادات الخارجية', 'إكلينيكي'],
    ];
    for (const d of noorDepts) await tx.run(insertDeptSql, d);

    const noorStaff = [
      ['stf-noor-01', 'fac-cairo-01', 'د. كريم محمود السعدني', 'NOR-101', 'طبيب', 'dep-noor-or'],
      ['stf-noor-02', 'fac-cairo-01', 'م. ندى إبراهيم علام', 'NOR-102', 'تمريض', 'dep-noor-icu'],
      ['stf-noor-03', 'fac-cairo-01', 'أ. ياسر فتحي جاد', 'NOR-103', 'خدمات معاونة', 'dep-noor-cssd'],
      ['stf-noor-04', 'fac-cairo-01', 'د. رانيا حسام الدين', 'NOR-104', 'طبيب', 'dep-noor-er'],
      ['stf-noor-05', 'fac-cairo-01', 'م. دعاء صبحي كامل', 'NOR-105', 'تمريض', 'dep-noor-or'],
      ['stf-noor-06', 'fac-cairo-01', 'أ. محمود زكي توفيق', 'NOR-106', 'إداري', 'dep-noor-opd'],
    ];
    for (const s of noorStaff) await tx.run(insertStaffSql, s);

    await tx.run(insertLeaderSql, [
      'ldr-fac-alex-02',
      'fac-alex-02',
      'د. شريف جلال الألفي',
      'د. نجلاء محمد بركات',
      'د. عادل حسني زهران',
      'أ. سلوى كمال المنشاوي',
    ]);

    const shifaDepts = [
      ['dep-shf-opd', 'fac-alex-02', 'العيادات التخصصية', 'إكلينيكي'],
      ['dep-shf-lab', 'fac-alex-02', 'المعمل وبنك الدم', 'معاون وخدمي'],
      ['dep-shf-day', 'fac-alex-02', 'عمليات اليوم الواحد', 'طوارئ وعمليات'],
      ['dep-shf-rad', 'fac-alex-02', 'الأشعة التشخيصية', 'معاون وخدمي'],
    ];
    for (const d of shifaDepts) await tx.run(insertDeptSql, d);

    const shifaStaff = [
      ['stf-shf-01', 'fac-alex-02', 'د. ماجد سامي غانم', 'SHF-201', 'طبيب', 'dep-shf-day'],
      ['stf-shf-02', 'fac-alex-02', 'م. هبة الله علي فوزي', 'SHF-202', 'تمريض', 'dep-shf-opd'],
      ['stf-shf-03', 'fac-alex-02', 'أ. حسام الدين رفعت', 'SHF-203', 'خدمات معاونة', 'dep-shf-lab'],
      ['stf-shf-04', 'fac-alex-02', 'د. مروة نبيل شوقي', 'SHF-204', 'طبيب', 'dep-shf-rad'],
    ];
    for (const s of shifaStaff) await tx.run(insertStaffSql, s);
  });
}

async function seedWeeklyRoundsIfMissing() {
  const existingRow = await db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM module_one_records WHERE json_extract(payload, '$.report_type') = 'weekly_round'"
  );
  if (Number(existingRow?.cnt || 0) > 0) return;

  const insertRoundSql = `INSERT OR IGNORE INTO module_one_records
       (id, facility_id, staff_id, department_id, legacy_id, created_by, payload, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  await db.transaction(async (tx) => {
    if (await tx.get('SELECT id FROM facilities WHERE id = ?', ['fac-cairo-01'])) {
      await tx.run(insertRoundSql, [
        'm1-round-noor-01',
        'fac-cairo-01',
        'stf-noor-01',
        'dep-noor-or',
        'round-noor-01',
        'usr-admin-01',
        JSON.stringify({
          report_type: 'weekly_round',
          date: '2026-11-03',
          period: 'صباحي',
          department: 'جناح العمليات الكبرى',
          inspector: 'د. هيثم فؤاد مصطفى',
          supervisor: 'د. كريم محمود السعدني',
          evaluations: [
            {
              procedure: 'الالتزام بغسل الأيدي وتطهيرها قبل وبعد التعامل مع المريض',
              status: 'Yes',
              note: 'الالتزام بغسل الأيدي وتطهيرها قبل وبعد التعامل مع المريض',
              rec: 'توفير مطهر كحولي بجانب كل سرير وتدريب الطاقم دورياً',
            },
            {
              procedure: 'ارتداء مهمات الوقاية الشخصية المناسبة (PPE)',
              status: 'Yes',
              note: 'ارتداء مهمات الوقاية الشخصية المناسبة (PPE)',
              rec: 'التأكد من توافر القفازات والكمامات والمرايل بالكمية الكافية',
            },
            {
              procedure: 'الفصل السليم للنفايات الطبية الخطرة وصناديق الأمان',
              status: 'No',
              note: 'تجاوز مستوى الامتلاء في صندوق الأمان بغرفة التحضير عن 3/4 السعة',
              rec: 'إغلاق الصندوق واستبداله فور بلوغ 3/4 السعة المقررة',
            },
          ],
        }),
        'pending',
        '2026-11-03T10:15:00.000Z',
      ]);

      await tx.run(insertRoundSql, [
        'm1-round-noor-02',
        'fac-cairo-01',
        'stf-noor-02',
        'dep-noor-icu',
        'round-noor-02',
        'usr-admin-01',
        JSON.stringify({
          report_type: 'weekly_round',
          date: '2026-11-10',
          period: 'صباحي',
          department: 'الرعاية المركزة',
          inspector: 'د. هيثم فؤاد مصطفى',
          supervisor: 'م. ندى إبراهيم علام',
          evaluations: [
            {
              procedure: 'الالتزام بغسل الأيدي وتطهيرها قبل وبعد التعامل مع المريض',
              status: 'Yes',
              note: 'الالتزام بغسل الأيدي وتطهيرها قبل وبعد التعامل مع المريض',
              rec: 'استمرار المتابعة اليومية وتوافر المطهرات',
            },
            {
              procedure: 'نظافة وتطهير الأسطح البيئية عالية اللمس',
              status: 'Yes',
              note: 'نظافة وتطهير الأسطح البيئية عالية اللمس',
              rec: 'الالتزام بتسجيل جدول التطهير الدوري بعد كل نوبتجية',
            },
          ],
        }),
        'completed',
        '2026-11-10T11:00:00.000Z',
      ]);

      await tx.run(insertRoundSql, [
        'm1-round-noor-03',
        'fac-cairo-01',
        'stf-noor-03',
        'dep-noor-cssd',
        'round-noor-03',
        'usr-admin-01',
        JSON.stringify({
          report_type: 'weekly_round',
          date: '2026-10-21',
          period: 'مسائي',
          department: 'التعقيم المركزي (CSSD)',
          inspector: 'د. منى السيد رضوان',
          supervisor: 'أ. ياسر فتحي جاد',
          evaluations: [
            {
              procedure: 'الحفظ الآمن للآلات المعقمة ومستلزمات الغيار',
              status: 'No',
              note: 'نقص توقيع المشرف على سجل المؤشر البيولوجي للفترة المسائية',
              rec: 'مراجعة السجلات قبل اعتماد التشغيل وتسجيل التوقيع فور القراءة',
            },
          ],
        }),
        'pending',
        '2026-10-21T16:30:00.000Z',
      ]);
    }

    if (await tx.get('SELECT id FROM facilities WHERE id = ?', ['fac-alex-02'])) {
      await tx.run(insertRoundSql, [
        'm1-round-shf-01',
        'fac-alex-02',
        'stf-shf-01',
        'dep-shf-day',
        'round-shf-01',
        'usr-admin-01',
        JSON.stringify({
          report_type: 'weekly_round',
          date: '2026-11-05',
          period: 'صباحي',
          department: 'عمليات اليوم الواحد',
          inspector: 'د. عادل حسني زهران',
          supervisor: 'د. ماجد سامي غانم',
          evaluations: [
            {
              procedure: 'الالتزام بغسل الأيدي وتطهيرها قبل وبعد التعامل مع المريض',
              status: 'Yes',
              note: 'الالتزام بغسل الأيدي وتطهيرها قبل وبعد التعامل مع المريض',
              rec: 'توفير مطهر كحولي بجانب كل سرير',
            },
            {
              procedure: 'نظافة وتطهير الأسطح البيئية عالية اللمس',
              status: 'No',
              note: 'عدم تدوين ساعة اختبار شريط فحص تركيز المطهر الصباحي',
              rec: 'تثبيت سجل ورقي ملزم بجانب حوض التطهير قبل بدء الحالات',
            },
          ],
        }),
        'pending',
        '2026-11-05T09:45:00.000Z',
      ]);
    }
  });
}

// ============================================================================
// 5. MODULE TWO (TRAINING) & MODULE THREE (HAND HYGIENE) TYPES & UNIFIED BRIDGE
// ============================================================================
interface TrainingEmployeeRecord {
  ID: string;
  Name: string;
  Job?: string;
  Category: string;
}

interface TrainingLogRecord {
  ID?: string | number;
  Date: string;
  Month?: number | string;
  Year?: number | string;
  Category: string;
  Policies: string;
  TraineeName: string;
  Trainer: string;
}

interface TrainingPlanRecord {
  ID?: string | number;
  Month: number | string;
  Year?: number | string;
  Category: string;
  Policies: string;
}

interface TrainingSettingRecord {
  ID?: string | number;
  Type: string;
  Value: string;
}

interface TrainingStateBundle {
  employees: TrainingEmployeeRecord[];
  logs: TrainingLogRecord[];
  settings: TrainingSettingRecord[];
  plan: TrainingPlanRecord[];
  categories: string[];
}

interface HhOpportunity {
  id?: string | number;
  number: number | string;
  indications: string[];
  action: string;
  gloves: boolean;
}

interface HhProfessional {
  id?: string | number;
  categoryCode: string;
  categoryName: string;
  _colNo?: number;
  _originalIndex?: number;
  opportunities: HhOpportunity[];
}

interface HhSessionInfo {
  sessionId: string;
  facility?: string;
  service?: string;
  ward?: string;
  department?: string;
  country?: string;
  city?: string;
  periodNumber?: string | number;
  date?: string;
  startTime?: string;
  endTime?: string;
  duration?: string | number;
  sessionNumber?: string | number;
  pageNumber?: string | number;
  observer?: string;
}

interface HhSessionRecord {
  sessionInfo: HhSessionInfo;
  professionals: HhProfessional[];
}

async function migrateLegacyTablesIntoUnifiedSchema() {
  const tableRows = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );
  const existingTables = new Set(tableRows.map((r) => r.name));

  const facilities = await db.all<{ id: string; name: string; governorate: string }>(
    'SELECT id, name, governorate FROM facilities'
  );

  await db.transaction(async (tx) => {
    for (const fac of facilities) {
      const master = await getOrCreateMasterSettings(fac.id, tx);
      const nextConfigs: ModuleConfigsJson = JSON.parse(JSON.stringify(master.module_configs));
      let configsDirty = false;
      let nextLogo = master.logo_url;

      // 1. Absorb legacy module_one_settings (stored temporarily if schema changed)
      if (existingTables.has('legacy_module_one_settings_tmp')) {
        const m1Set = await tx.get<{ settings_json: string }>(
          'SELECT settings_json FROM legacy_module_one_settings_tmp WHERE facility_id = ?',
          [fac.id]
        );
        if (m1Set) {
          try {
            const parsed = JSON.parse(m1Set.settings_json) as Record<string, unknown>;
            if (typeof parsed.rightLogoUrl === 'string' && parsed.rightLogoUrl) {
              nextConfigs.shared.right_logo_url = parsed.rightLogoUrl;
              if (!nextLogo) nextLogo = parsed.rightLogoUrl;
            }
            if (typeof parsed.leftLogoUrl === 'string' && parsed.leftLogoUrl) {
              nextConfigs.shared.left_logo_url = parsed.leftLogoUrl;
            }
            if (Array.isArray(parsed.periods) && parsed.periods.length > 0) {
              nextConfigs.reports.periods = parsed.periods.map(String);
            }
            if (Array.isArray(parsed.procedures) && parsed.procedures.length > 0) {
              nextConfigs.reports.procedures = parsed.procedures as ReportProcedureConfig[];
            }
            configsDirty = true;
          } catch {
            // ignore corrupted legacy JSON
          }
        }
      }

      // 2. Absorb legacy module_two_training_state if present
      if (existingTables.has('module_two_training_state')) {
        const m2State = await tx.get<{ data_json: string }>(
          'SELECT data_json FROM module_two_training_state WHERE facility_id = ?',
          [fac.id]
        );
        if (m2State) {
          try {
            const parsed = JSON.parse(m2State.data_json) as Partial<TrainingStateBundle>;
            if (Array.isArray(parsed.categories) && parsed.categories.length > 0) {
              nextConfigs.training.categories = Array.from(
                new Set([...nextConfigs.training.categories, ...parsed.categories])
              );
              configsDirty = true;
            }
            if (Array.isArray(parsed.settings)) {
              const pols = parsed.settings.filter((s) => s.Type === 'Policy').map((s) => s.Value);
              const trns = parsed.settings.filter((s) => s.Type === 'Trainer').map((s) => s.Value);
              if (pols.length > 0) nextConfigs.training.policies = Array.from(new Set(pols));
              if (trns.length > 0) nextConfigs.training.trainers = Array.from(new Set(trns));
              const icTitle = parsed.settings.find((s) => s.Type === 'IC_Manager_Title')?.Value;
              const hmTitle = parsed.settings.find((s) => s.Type === 'Hospital_Manager_Title')?.Value;
              if (icTitle) nextConfigs.training.ic_manager_title = icTitle;
              if (hmTitle) nextConfigs.training.hospital_manager_title = hmTitle;
              configsDirty = true;
            }

            const m2CntRow = await tx.get<{ cnt: number }>(
              "SELECT COUNT(*) as cnt FROM module_two_records WHERE facility_id = ? AND status IN ('training_log', 'training_plan')",
              [fac.id]
            );
            const existingM2Training = Number(m2CntRow?.cnt || 0);

            if (existingM2Training === 0) {
              const firstDeptRow = await tx.get<{ id: string }>(
                'SELECT id FROM facility_departments WHERE facility_id = ? LIMIT 1',
                [fac.id]
              );
              const firstDept = firstDeptRow?.id || 'unassigned';
              const insM2Sql = `INSERT OR IGNORE INTO module_two_records
                   (id, facility_id, department_id, legacy_id, created_by, payload, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
              for (const log of parsed.logs || []) {
                const lid = String(log.ID || `trn-${crypto.randomUUID().slice(0, 8)}`);
                await tx.run(insM2Sql, [
                  `m2-trn-${crypto.randomUUID().slice(0, 12)}`,
                  fac.id,
                  firstDept,
                  lid,
                  'system',
                  JSON.stringify({ record_type: 'training_log', ...log }),
                  'training_log',
                  log.Date ? `${String(log.Date).split('T')[0]}T09:00:00.000Z` : new Date().toISOString(),
                ]);
              }
              for (const pln of parsed.plan || []) {
                const lid = String(pln.ID || `pln-${crypto.randomUUID().slice(0, 8)}`);
                await tx.run(insM2Sql, [
                  `m2-pln-${crypto.randomUUID().slice(0, 12)}`,
                  fac.id,
                  firstDept,
                  lid,
                  'system',
                  JSON.stringify({ record_type: 'training_plan', ...pln }),
                  'training_plan',
                  new Date().toISOString(),
                ]);
              }
            }
          } catch {
            // ignore
          }
        }
      }

      // 3. Absorb legacy module_three_hh_settings & module_three_hh_sessions if present
      if (existingTables.has('module_three_hh_settings')) {
        const hhSet = await tx.get<{ settings_json: string }>(
          'SELECT settings_json FROM module_three_hh_settings WHERE facility_id = ?',
          [fac.id]
        );
        if (hhSet) {
          try {
            const parsed = JSON.parse(hhSet.settings_json) as Record<string, unknown>;
            if (typeof parsed.header1 === 'string') nextConfigs.hand_hygiene.header1 = parsed.header1;
            if (typeof parsed.header2 === 'string') nextConfigs.hand_hygiene.header2 = parsed.header2;
            if (typeof parsed.header3 === 'string') nextConfigs.hand_hygiene.header3 = parsed.header3;
            if (Array.isArray(parsed.services) && parsed.services.length > 0) {
              nextConfigs.hand_hygiene.services = parsed.services.map(String);
            }
            if (Array.isArray(parsed.wards) && parsed.wards.length > 0) {
              nextConfigs.hand_hygiene.wards = parsed.wards.map(String);
            }
            if (Array.isArray(parsed.cities) && parsed.cities.length > 0) {
              nextConfigs.hand_hygiene.cities = parsed.cities.map(String);
            }
            if (Array.isArray(parsed.profCategories) && parsed.profCategories.length > 0) {
              nextConfigs.hand_hygiene.profCategories = parsed.profCategories.map(String);
            }
            if (Array.isArray(parsed.observers) && parsed.observers.length > 0) {
              nextConfigs.hand_hygiene.observers = parsed.observers.map(String);
            }
            if (typeof parsed.logoRight === 'string' && parsed.logoRight && !nextConfigs.shared.right_logo_url) {
              nextConfigs.shared.right_logo_url = parsed.logoRight;
            }
            if (typeof parsed.logoLeft === 'string' && parsed.logoLeft && !nextConfigs.shared.left_logo_url) {
              nextConfigs.shared.left_logo_url = parsed.logoLeft;
            }
            configsDirty = true;
          } catch {
            // ignore
          }
        }
      }

      if (existingTables.has('module_three_hh_sessions')) {
        const m3CntRow = await tx.get<{ cnt: number }>(
          "SELECT COUNT(*) as cnt FROM module_three_records WHERE facility_id = ? AND status = 'hand_hygiene'",
          [fac.id]
        );
        const existingM3Hh = Number(m3CntRow?.cnt || 0);

        if (existingM3Hh === 0) {
          const hhRows = await tx.all<{
            session_id: string;
            session_date: string;
            department: string;
            payload_json: string;
            updated_at: string;
          }>(
            'SELECT session_id, session_date, department, payload_json, updated_at FROM module_three_hh_sessions WHERE facility_id = ?',
            [fac.id]
          );

          const deptRows = await tx.all<{ id: string; name: string }>(
            'SELECT id, name FROM facility_departments WHERE facility_id = ?',
            [fac.id]
          );
          const deptMap = new Map(deptRows.map((d) => [d.name.trim(), d.id]));
          const firstDept = Array.from(deptMap.values())[0] || 'unassigned';

          const insM3Sql = `INSERT OR IGNORE INTO module_three_records
               (id, facility_id, department_id, legacy_id, created_by, payload, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
          for (const hr of hhRows) {
            try {
              const parsed = JSON.parse(hr.payload_json) as HhSessionRecord;
              const deptId = deptMap.get(hr.department.trim()) || firstDept;
              await tx.run(insM3Sql, [
                `m3-hh-${crypto.randomUUID().slice(0, 12)}`,
                fac.id,
                deptId,
                hr.session_id,
                'system',
                JSON.stringify({ record_type: 'hand_hygiene', ...parsed }),
                'hand_hygiene',
                hr.session_date ? `${hr.session_date}T09:00:00.000Z` : hr.updated_at,
              ]);
            } catch {
              // skip invalid row
            }
          }
        }
      }

      if (configsDirty) {
        await saveMasterSettings(
          fac.id,
          {
            logo_url: nextLogo,
            module_configs: nextConfigs,
          },
          tx
        );
      }

      // Ensure each facility has its isolated per-module settings rows initialized
      await getOrCreateModuleOneSettings(fac.id, tx);
      await getOrCreateModuleTwoSettings(fac.id, tx);
      await getOrCreateModuleThreeSettings(fac.id, tx);
    }

    // Drop old temporary/legacy isolated tables once absorbed
    if (existingTables.has('legacy_module_one_settings_tmp')) {
      await tx.exec('DROP TABLE IF EXISTS legacy_module_one_settings_tmp');
    }
    if (existingTables.has('module_two_training_state')) await tx.exec('DROP TABLE IF EXISTS module_two_training_state');
    if (existingTables.has('module_three_hh_sessions')) await tx.exec('DROP TABLE IF EXISTS module_three_hh_sessions');
    if (existingTables.has('module_three_hh_settings')) await tx.exec('DROP TABLE IF EXISTS module_three_hh_settings');
  });
}

async function seedTrainingInModuleTwoIfMissing() {
  const existingRow = await db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM module_two_records WHERE status IN ('training_log', 'training_plan')"
  );
  if (Number(existingRow?.cnt || 0) > 0) return;

  const currentYear = new Date().getFullYear();
  const insSql = `INSERT OR IGNORE INTO module_two_records
       (id, facility_id, department_id, legacy_id, created_by, payload, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  await db.transaction(async (tx) => {
    for (const facilityId of ['fac-cairo-01', 'fac-alex-02']) {
      if (!(await tx.get('SELECT id FROM facilities WHERE id = ?', [facilityId]))) continue;
      const settings = await getOrCreateMasterSettings(facilityId, tx);
      const icManager =
        settings.ic_supervisor !== 'غير محدد' ? settings.ic_supervisor : 'مشرف مكافحة العدوى';
      const nursingLead =
        settings.nursing_director !== 'غير محدد' ? settings.nursing_director : 'رئيس هيئة التمريض';
      const staff = await tx.all<{ id: string; name: string; category: string; department_id: string }>(
        'SELECT id, name, category, department_id FROM facility_staff WHERE facility_id = ?',
        [facilityId]
      );
      const firstDept = staff[0]?.department_id || 'unassigned';

      if (facilityId === 'fac-cairo-01') {
        const plans = [
          {
            ID: 'pln-noor-10-doc',
            Month: 10,
            Year: currentYear,
            Category: 'أطباء',
            Policies: 'سياسة غسل الأيدي, سياسة التعقيم والتطهير',
          },
          {
            ID: 'pln-noor-10-nur',
            Month: 10,
            Year: currentYear,
            Category: 'تمريض',
            Policies: 'سياسة مهمات الوقاية الشخصية (PPE), سياسة التعامل مع الوخز بالإبر',
          },
          {
            ID: 'pln-noor-11-nur',
            Month: 11,
            Year: currentYear,
            Category: 'تمريض',
            Policies: 'سياسة غسل الأيدي, سياسة إدارة النفايات الطبية الخطرة',
          },
          {
            ID: 'pln-noor-11-wrk',
            Month: 11,
            Year: currentYear,
            Category: 'خدمات معاونة',
            Policies: 'سياسة إدارة النفايات الطبية الخطرة',
          },
        ];
        for (const p of plans) {
          await tx.run(insSql, [
            `m2-${p.ID}`,
            facilityId,
            firstDept,
            p.ID,
            'usr-admin-01',
            JSON.stringify({ record_type: 'training_plan', ...p }),
            'training_plan',
            `${currentYear}-10-01T08:00:00.000Z`,
          ]);
        }

        for (let idx = 0; idx < staff.length; idx++) {
          const member = staff[idx];
          const tCat = mapStaffCategoryToTrainingCategory(member.category);
          if (tCat === 'أطباء') {
            await tx.run(insSql, [
              `m2-trn-noor-${idx}`,
              facilityId,
              member.department_id,
              `trn-noor-d-${idx}`,
              'usr-admin-01',
              JSON.stringify({
                record_type: 'training_log',
                ID: `trn-noor-d-${idx}`,
                Date: `${currentYear}-10-18`,
                Month: 10,
                Year: currentYear,
                Category: 'أطباء',
                Policies: 'سياسة غسل الأيدي, سياسة التعقيم والتطهير',
                TraineeName: member.name,
                Trainer: icManager,
              }),
              'training_log',
              `${currentYear}-10-18T10:00:00.000Z`,
            ]);
          } else if (tCat === 'تمريض') {
            await tx.run(insSql, [
              `m2-trn-noor-${idx}`,
              facilityId,
              member.department_id,
              `trn-noor-n-${idx}`,
              'usr-admin-01',
              JSON.stringify({
                record_type: 'training_log',
                ID: `trn-noor-n-${idx}`,
                Date: `${currentYear}-11-05`,
                Month: 11,
                Year: currentYear,
                Category: 'تمريض',
                Policies: 'سياسة غسل الأيدي, سياسة مهمات الوقاية الشخصية (PPE)',
                TraineeName: member.name,
                Trainer: nursingLead,
              }),
              'training_log',
              `${currentYear}-11-05T10:00:00.000Z`,
            ]);
          } else if (tCat === 'خدمات معاونة') {
            await tx.run(insSql, [
              `m2-trn-noor-${idx}`,
              facilityId,
              member.department_id,
              `trn-noor-s-${idx}`,
              'usr-admin-01',
              JSON.stringify({
                record_type: 'training_log',
                ID: `trn-noor-s-${idx}`,
                Date: `${currentYear}-11-09`,
                Month: 11,
                Year: currentYear,
                Category: 'خدمات معاونة',
                Policies: 'سياسة إدارة النفايات الطبية الخطرة',
                TraineeName: member.name,
                Trainer: icManager,
              }),
              'training_log',
              `${currentYear}-11-09T10:00:00.000Z`,
            ]);
          }
        }
      } else if (facilityId === 'fac-alex-02') {
        const plans = [
          {
            ID: 'pln-shf-10-doc',
            Month: 10,
            Year: currentYear,
            Category: 'أطباء',
            Policies: 'سياسة غسل الأيدي, سياسة مهمات الوقاية الشخصية (PPE)',
          },
          {
            ID: 'pln-shf-11-nur',
            Month: 11,
            Year: currentYear,
            Category: 'تمريض',
            Policies: 'سياسة التعامل مع الوخز بالإبر, سياسة إدارة النفايات الطبية الخطرة',
          },
        ];
        for (const p of plans) {
          await tx.run(insSql, [
            `m2-${p.ID}`,
            facilityId,
            firstDept,
            p.ID,
            'usr-admin-01',
            JSON.stringify({ record_type: 'training_plan', ...p }),
            'training_plan',
            `${currentYear}-10-01T08:00:00.000Z`,
          ]);
        }

        for (let idx = 0; idx < staff.length; idx++) {
          const member = staff[idx];
          const tCat = mapStaffCategoryToTrainingCategory(member.category);
          if (tCat === 'أطباء') {
            await tx.run(insSql, [
              `m2-trn-shf-${idx}`,
              facilityId,
              member.department_id,
              `trn-shf-d-${idx}`,
              'usr-admin-01',
              JSON.stringify({
                record_type: 'training_log',
                ID: `trn-shf-d-${idx}`,
                Date: `${currentYear}-10-22`,
                Month: 10,
                Year: currentYear,
                Category: 'أطباء',
                Policies: 'سياسة غسل الأيدي, سياسة مهمات الوقاية الشخصية (PPE)',
                TraineeName: member.name,
                Trainer: icManager,
              }),
              'training_log',
              `${currentYear}-10-22T10:00:00.000Z`,
            ]);
          } else if (tCat === 'تمريض') {
            await tx.run(insSql, [
              `m2-trn-shf-${idx}`,
              facilityId,
              member.department_id,
              `trn-shf-n-${idx}`,
              'usr-admin-01',
              JSON.stringify({
                record_type: 'training_log',
                ID: `trn-shf-n-${idx}`,
                Date: `${currentYear}-11-07`,
                Month: 11,
                Year: currentYear,
                Category: 'تمريض',
                Policies: 'سياسة التعامل مع الوخز بالإبر',
                TraineeName: member.name,
                Trainer: nursingLead,
              }),
              'training_log',
              `${currentYear}-11-07T10:00:00.000Z`,
            ]);
          }
        }
      }
    }
  });
}

async function seedHandHygieneInModuleThreeIfMissing() {
  const existingRow = await db.get<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM module_three_records WHERE status = 'hand_hygiene'"
  );
  if (Number(existingRow?.cnt || 0) > 0) return;

  const insSql = `INSERT OR IGNORE INTO module_three_records
       (id, facility_id, department_id, legacy_id, created_by, payload, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  await db.transaction(async (tx) => {
    if (await tx.get('SELECT id FROM facilities WHERE id = ?', ['fac-cairo-01'])) {
      const noorSessions: Array<{ deptId: string; rec: HhSessionRecord }> = [
        {
          deptId: 'dep-noor-or',
          rec: {
            sessionInfo: {
              sessionId: 'hh-noor-01',
              facility: 'مستشفى النور التخصصي',
              service: 'عمليات',
              ward: 'الدور الثاني',
              department: 'جناح العمليات الكبرى',
              country: 'Egypt',
              city: 'القاهرة',
              periodNumber: '11',
              date: '2026-11-04',
              startTime: '09:30',
              endTime: '09:50',
              duration: '20',
              sessionNumber: '1',
              pageNumber: '1',
              observer: 'د. هيثم فؤاد مصطفى',
            },
            professionals: [
              {
                categoryCode: '1',
                categoryName: 'أطباء',
                _colNo: 1,
                opportunities: [
                  { number: 1, indications: ['bef-pat'], action: 'HR', gloves: false },
                  { number: 2, indications: ['bef-asept'], action: 'HW', gloves: true },
                  { number: 3, indications: ['aft-pat'], action: 'HR', gloves: false },
                ],
              },
              {
                categoryCode: '2',
                categoryName: 'تمريض',
                _colNo: 2,
                opportunities: [
                  { number: 1, indications: ['bef-pat'], action: 'HR', gloves: false },
                  { number: 2, indications: ['aft-bf'], action: 'HW', gloves: true },
                  { number: 3, indications: ['aft-p-surr'], action: 'HR', gloves: false },
                ],
              },
              {
                categoryCode: '3',
                categoryName: 'مساعد تمريض',
                _colNo: 3,
                opportunities: [
                  { number: 1, indications: ['aft-p-surr'], action: 'HR', gloves: true },
                  { number: 2, indications: ['bef-pat'], action: 'Missed', gloves: false },
                ],
              },
              {
                categoryCode: '4',
                categoryName: 'عمال',
                _colNo: 4,
                opportunities: [{ number: 1, indications: ['aft-p-surr'], action: 'HW', gloves: true }],
              },
            ],
          },
        },
        {
          deptId: 'dep-noor-icu',
          rec: {
            sessionInfo: {
              sessionId: 'hh-noor-02',
              facility: 'مستشفى النور التخصصي',
              service: 'داخلي',
              ward: 'الدور الأول',
              department: 'الرعاية المركزة',
              country: 'Egypt',
              city: 'القاهرة',
              periodNumber: '11',
              date: '2026-11-08',
              startTime: '11:00',
              endTime: '11:25',
              duration: '25',
              sessionNumber: '2',
              pageNumber: '1',
              observer: 'د. هيثم فؤاد مصطفى',
            },
            professionals: [
              {
                categoryCode: '1',
                categoryName: 'أطباء',
                _colNo: 1,
                opportunities: [
                  { number: 1, indications: ['bef-pat'], action: 'HR', gloves: false },
                  { number: 2, indications: ['bef-asept'], action: 'HR', gloves: true },
                  { number: 3, indications: ['aft-pat'], action: 'Missed', gloves: false },
                ],
              },
              {
                categoryCode: '2',
                categoryName: 'تمريض',
                _colNo: 2,
                opportunities: [
                  { number: 1, indications: ['bef-asept'], action: 'HW', gloves: true },
                  { number: 2, indications: ['aft-bf', 'aft-pat'], action: 'HW', gloves: true },
                  { number: 3, indications: ['bef-pat'], action: 'HR', gloves: false },
                ],
              },
              { categoryCode: '3', categoryName: 'مساعد تمريض', _colNo: 3, opportunities: [] },
              {
                categoryCode: '4',
                categoryName: 'عمال',
                _colNo: 4,
                opportunities: [{ number: 1, indications: ['aft-p-surr'], action: 'Missed', gloves: true }],
              },
            ],
          },
        },
        {
          deptId: 'dep-noor-er',
          rec: {
            sessionInfo: {
              sessionId: 'hh-noor-03',
              facility: 'مستشفى النور التخصصي',
              service: 'طوارئ',
              ward: 'الدور الأرضي',
              department: 'الطوارئ والاستقبال',
              country: 'Egypt',
              city: 'القاهرة',
              periodNumber: '10',
              date: '2026-10-22',
              startTime: '10:15',
              endTime: '10:35',
              duration: '20',
              sessionNumber: '1',
              pageNumber: '1',
              observer: 'أ. فاطمة حسن النجار',
            },
            professionals: [
              {
                categoryCode: '1',
                categoryName: 'أطباء',
                _colNo: 1,
                opportunities: [
                  { number: 1, indications: ['bef-pat'], action: 'HR', gloves: false },
                  { number: 2, indications: ['aft-pat'], action: 'HR', gloves: false },
                ],
              },
              {
                categoryCode: '2',
                categoryName: 'تمريض',
                _colNo: 2,
                opportunities: [
                  { number: 1, indications: ['bef-asept'], action: 'HW', gloves: true },
                  { number: 2, indications: ['aft-p-surr'], action: 'HR', gloves: false },
                ],
              },
              { categoryCode: '3', categoryName: 'مساعد تمريض', _colNo: 3, opportunities: [] },
              { categoryCode: '4', categoryName: 'عمال', _colNo: 4, opportunities: [] },
            ],
          },
        },
      ];
      for (const item of noorSessions) {
        await tx.run(insSql, [
          `m3-${item.rec.sessionInfo.sessionId}`,
          'fac-cairo-01',
          item.deptId,
          item.rec.sessionInfo.sessionId,
          'usr-admin-01',
          JSON.stringify({ record_type: 'hand_hygiene', ...item.rec }),
          'hand_hygiene',
          `${item.rec.sessionInfo.date}T10:00:00.000Z`,
        ]);
      }
    }

    if (await tx.get('SELECT id FROM facilities WHERE id = ?', ['fac-alex-02'])) {
      const shifaSessions: Array<{ deptId: string; rec: HhSessionRecord }> = [
        {
          deptId: 'dep-shf-day',
          rec: {
            sessionInfo: {
              sessionId: 'hh-shf-01',
              facility: 'مركز الشفاء الطبي المتكامل',
              service: 'عمليات',
              ward: 'الدور الأول',
              department: 'عمليات اليوم الواحد',
              country: 'Egypt',
              city: 'الإسكندرية',
              periodNumber: '11',
              date: '2026-11-05',
              startTime: '10:00',
              endTime: '10:20',
              duration: '20',
              sessionNumber: '1',
              pageNumber: '1',
              observer: 'د. عادل حسني زهران',
            },
            professionals: [
              {
                categoryCode: '1',
                categoryName: 'أطباء',
                _colNo: 1,
                opportunities: [
                  { number: 1, indications: ['bef-pat'], action: 'HR', gloves: false },
                  { number: 2, indications: ['bef-asept'], action: 'HW', gloves: true },
                  { number: 3, indications: ['aft-pat'], action: 'HR', gloves: false },
                ],
              },
              {
                categoryCode: '2',
                categoryName: 'تمريض',
                _colNo: 2,
                opportunities: [
                  { number: 1, indications: ['bef-pat'], action: 'HR', gloves: false },
                  { number: 2, indications: ['aft-bf'], action: 'HW', gloves: true },
                ],
              },
              { categoryCode: '3', categoryName: 'مساعد تمريض', _colNo: 3, opportunities: [] },
              { categoryCode: '4', categoryName: 'عمال', _colNo: 4, opportunities: [] },
            ],
          },
        },
        {
          deptId: 'dep-shf-opd',
          rec: {
            sessionInfo: {
              sessionId: 'hh-shf-02',
              facility: 'مركز الشفاء الطبي المتكامل',
              service: 'عيادات خارجية',
              ward: 'الدور الأرضي',
              department: 'العيادات التخصصية',
              country: 'Egypt',
              city: 'الإسكندرية',
              periodNumber: '11',
              date: '2026-11-09',
              startTime: '12:00',
              endTime: '12:20',
              duration: '20',
              sessionNumber: '2',
              pageNumber: '1',
              observer: 'أ. سلوى كمال المنشاوي',
            },
            professionals: [
              {
                categoryCode: '1',
                categoryName: 'أطباء',
                _colNo: 1,
                opportunities: [
                  { number: 1, indications: ['bef-pat'], action: 'HR', gloves: false },
                  { number: 2, indications: ['aft-pat'], action: 'Missed', gloves: false },
                ],
              },
              {
                categoryCode: '2',
                categoryName: 'تمريض',
                _colNo: 2,
                opportunities: [
                  { number: 1, indications: ['bef-asept'], action: 'HR', gloves: false },
                  { number: 2, indications: ['aft-p-surr'], action: 'HW', gloves: false },
                ],
              },
              { categoryCode: '3', categoryName: 'مساعد تمريض', _colNo: 3, opportunities: [] },
              { categoryCode: '4', categoryName: 'عمال', _colNo: 4, opportunities: [] },
            ],
          },
        },
      ];
      for (const item of shifaSessions) {
        await tx.run(insSql, [
          `m3-${item.rec.sessionInfo.sessionId}`,
          'fac-alex-02',
          item.deptId,
          item.rec.sessionInfo.sessionId,
          'usr-admin-01',
          JSON.stringify({ record_type: 'hand_hygiene', ...item.rec }),
          'hand_hygiene',
          `${item.rec.sessionInfo.date}T10:00:00.000Z`,
        ]);
      }
    }
  });
}

async function backfillUnifiedFacilityLogos() {
  const facs = await db.all<{ id: string; right_logo_url: string; left_logo_url: string }>(
    'SELECT id, right_logo_url, left_logo_url FROM facilities'
  );

  for (const fac of facs) {
    let right = String(fac.right_logo_url || '').trim();
    let left = String(fac.left_logo_url || '').trim();
    if (right && left) continue;

    // Inspect existing per-module & master settings to preserve previously configured logos
    const m1Row = await db.get<{ payload: string }>(
      'SELECT payload FROM module_one_settings WHERE facility_id = ?',
      [fac.id]
    );
    if (m1Row) {
      try {
        const p = JSON.parse(m1Row.payload) as { rightLogoUrl?: string; leftLogoUrl?: string };
        if (!right && p.rightLogoUrl?.trim()) right = p.rightLogoUrl.trim();
        if (!left && p.leftLogoUrl?.trim()) left = p.leftLogoUrl.trim();
      } catch {
        // ignore
      }
    }

    const m3Row = await db.get<{ payload: string }>(
      'SELECT payload FROM module_three_settings WHERE facility_id = ?',
      [fac.id]
    );
    if (m3Row) {
      try {
        const p = JSON.parse(m3Row.payload) as { logoRight?: string; logoLeft?: string };
        if (!right && p.logoRight?.trim()) right = p.logoRight.trim();
        if (!left && p.logoLeft?.trim()) left = p.logoLeft.trim();
      } catch {
        // ignore
      }
    }

    const m2Row = await db.get<{ payload: string }>(
      'SELECT payload FROM module_two_settings WHERE facility_id = ?',
      [fac.id]
    );
    if (m2Row) {
      try {
        const p = JSON.parse(m2Row.payload) as { settings?: Array<{ Type: string; Value: string }> };
        if (Array.isArray(p.settings)) {
          const rItem = p.settings.slice().reverse().find((s) => s.Type === 'Hospital_Logo');
          const lItem = p.settings.slice().reverse().find((s) => s.Type === 'Hospital_Logo_Left');
          if (!right && rItem?.Value?.trim()) right = rItem.Value.trim();
          if (!left && lItem?.Value?.trim()) left = lItem.Value.trim();
        }
      } catch {
        // ignore
      }
    }

    const mstRow = await db.get<{ logo_url?: string; module_configs_json?: string }>(
      'SELECT logo_url, module_configs_json FROM facility_master_settings WHERE facility_id = ?',
      [fac.id]
    );
    if (mstRow) {
      if (!right && mstRow.logo_url?.trim()) right = mstRow.logo_url.trim();
      if (mstRow.module_configs_json) {
        try {
          const cfg = JSON.parse(mstRow.module_configs_json) as {
            shared?: { right_logo_url?: string; left_logo_url?: string };
          };
          if (!right && cfg.shared?.right_logo_url?.trim()) right = cfg.shared.right_logo_url.trim();
          if (!left && cfg.shared?.left_logo_url?.trim()) left = cfg.shared.left_logo_url.trim();
        } catch {
          // ignore
        }
      }
    }

    if (right !== (fac.right_logo_url || '') || left !== (fac.left_logo_url || '')) {
      await db.run('UPDATE facilities SET right_logo_url = ?, left_logo_url = ? WHERE id = ?', [
        right,
        left,
        fac.id,
      ]);
    }
  }
}

let dbInitPromise: Promise<void> | null = null;

export async function ensureDbReady(): Promise<void> {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      await initializeSchemaAndColumns();
      await seedInitialData();
      await migrateLegacyTablesIntoUnifiedSchema();
      await backfillUnifiedFacilityLogos();
      await seedWeeklyRoundsIfMissing();
      await seedTrainingInModuleTwoIfMissing();
      await seedHandHygieneInModuleThreeIfMissing();
    })().catch((err) => {
      dbInitPromise = null;
      throw err;
    });
  }
  return dbInitPromise;
}

// ============================================================================
// 6. MODULE QUERY & MUTATION HELPERS (READ/WRITE UNIFIED TABLES ONLY)
// ============================================================================
async function buildTrainingBundleFromUnifiedDb(
  facilityId: string,
  execDb: DbExecutor = db
): Promise<TrainingStateBundle> {
  const m2Settings = await getOrCreateModuleTwoSettings(facilityId, execDb);

  let employees: TrainingEmployeeRecord[] = [];
  if (Array.isArray(m2Settings.employees)) {
    employees = m2Settings.employees;
  } else {
    const depts = await execDb.all<{ id: string; name: string }>(
      'SELECT id, name FROM facility_departments WHERE facility_id = ?',
      [facilityId]
    );
    const staff = await execDb.all<{
      id: string;
      name: string;
      employee_code: string;
      category: string;
      department_id: string;
    }>(
      'SELECT id, name, employee_code, category, department_id FROM facility_staff WHERE facility_id = ? ORDER BY name ASC',
      [facilityId]
    );

    const deptNameMap = new Map(depts.map((d) => [d.id, d.name]));
    employees = staff.map((s) => ({
      ID: s.employee_code || s.id,
      Name: s.name,
      Job: deptNameMap.get(s.department_id) || s.category,
      Category: mapStaffCategoryToTrainingCategory(s.category),
    }));
  }

  const m2Rows = await execDb.all<{
    id: string;
    legacy_id: string | null;
    payload: string;
    status: string;
  }>(
    "SELECT id, legacy_id, payload, status FROM module_two_records WHERE facility_id = ? AND status IN ('training_log', 'training_plan') ORDER BY created_at DESC",
    [facilityId]
  );

  const logs: TrainingLogRecord[] = [];
  const plan: TrainingPlanRecord[] = [];

  for (const r of m2Rows) {
    try {
      const p = JSON.parse(r.payload) as Record<string, unknown>;
      if (r.status === 'training_log' || p.record_type === 'training_log') {
        logs.push({
          ID: String(p.ID || r.legacy_id || r.id),
          Date: String(p.Date || ''),
          Month: (p.Month as number | string | undefined) ?? '',
          Year: (p.Year as number | string | undefined) ?? '',
          Category: String(p.Category || ''),
          Policies: String(p.Policies || ''),
          TraineeName: String(p.TraineeName || ''),
          Trainer: String(p.Trainer || ''),
        });
      } else if (r.status === 'training_plan' || p.record_type === 'training_plan') {
        plan.push({
          ID: String(p.ID || r.legacy_id || r.id),
          Month: (p.Month as number | string) ?? 1,
          Year: (p.Year as number | string | undefined) ?? new Date().getFullYear(),
          Category: String(p.Category || ''),
          Policies: String(p.Policies || ''),
        });
      }
    } catch {
      // skip invalid
    }
  }

  const settings = m2Settings.settings || [];
  const categories = Array.from(
    new Set([
      ...(m2Settings.categories || []),
      ...settings.filter((s) => s.Type === 'Category' && s.Value).map((s) => s.Value),
      ...employees.map((e) => e.Category).filter(Boolean),
    ])
  );

  return { employees, logs, settings, plan, categories };
}

async function saveTrainingBundleToUnifiedDb(
  facilityId: string,
  bundle: TrainingStateBundle,
  createdBy: string
): Promise<TrainingStateBundle> {
  const firstDeptRow = await db.get<{ id: string }>(
    'SELECT id FROM facility_departments WHERE facility_id = ? LIMIT 1',
    [facilityId]
  );
  const firstDept = firstDeptRow?.id || 'unassigned';

  await db.transaction(async (tx) => {
    await tx.run(
      "DELETE FROM module_two_records WHERE facility_id = ? AND status IN ('training_log', 'training_plan')",
      [facilityId]
    );

    const insSql = `INSERT INTO module_two_records
         (id, facility_id, department_id, legacy_id, created_by, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    for (const log of bundle.logs || []) {
      const uid = `m2-${crypto.randomUUID()}`;
      const lid = log.ID ? String(log.ID) : uid;
      const dateStr = String(log.Date || '').split('T')[0];
      await tx.run(insSql, [
        uid,
        facilityId,
        firstDept,
        lid,
        createdBy,
        JSON.stringify({ record_type: 'training_log', ...log, ID: lid }),
        'training_log',
        dateStr ? `${dateStr}T09:00:00.000Z` : new Date().toISOString(),
      ]);
    }

    for (const pln of bundle.plan || []) {
      const uid = `m2-${crypto.randomUUID()}`;
      const lid = pln.ID ? String(pln.ID) : uid;
      await tx.run(insSql, [
        uid,
        facilityId,
        firstDept,
        lid,
        createdBy,
        JSON.stringify({ record_type: 'training_plan', ...pln, ID: lid }),
        'training_plan',
        new Date().toISOString(),
      ]);
    }

    // Persist isolated Module Two settings + categories + employees scoped strictly to facility_id
    await saveModuleTwoSettings(
      facilityId,
      {
        settings: Array.isArray(bundle.settings) ? bundle.settings : undefined,
        categories: Array.isArray(bundle.categories) ? bundle.categories : undefined,
        employees: Array.isArray(bundle.employees) ? bundle.employees : undefined,
      },
      tx
    );
  });

  return buildTrainingBundleFromUnifiedDb(facilityId);
}

function resequenceHhSessions(sessionsList: HhSessionRecord[]): HhSessionRecord[] {
  const cloned = sessionsList.map((s) => ({
    ...s,
    sessionInfo: { ...s.sessionInfo },
  }));

  const monthGroups: Record<string, HhSessionRecord[]> = {};
  for (const s of cloned) {
    const mKey = String(s.sessionInfo.date || '').slice(0, 7) || 'unknown';
    if (!monthGroups[mKey]) monthGroups[mKey] = [];
    monthGroups[mKey].push(s);
  }

  for (const list of Object.values(monthGroups)) {
    list.sort((a, b) => {
      const dA = a.sessionInfo.date || '';
      const dB = b.sessionInfo.date || '';
      if (dA !== dB) return dA.localeCompare(dB);
      const tA = a.sessionInfo.startTime || '99:99';
      const tB = b.sessionInfo.startTime || '99:99';
      if (tA !== tB) return tA.localeCompare(tB);
      return (a.sessionInfo.sessionId || '').localeCompare(b.sessionInfo.sessionId || '');
    });
    list.forEach((s, idx) => {
      s.sessionInfo.sessionNumber = String(idx + 1);
    });
  }

  cloned.sort((a, b) => {
    const dB = b.sessionInfo.date || '';
    const dA = a.sessionInfo.date || '';
    if (dB !== dA) return dB.localeCompare(dA);
    return (b.sessionInfo.startTime || '').localeCompare(a.sessionInfo.startTime || '');
  });

  return cloned;
}

async function getFacilityHhSessions(
  facilityId: string,
  execDb: DbExecutor = db
): Promise<HhSessionRecord[]> {
  const rows = await execDb.all<{ id: string; legacy_id: string | null; payload: string }>(
    "SELECT id, legacy_id, payload FROM module_three_records WHERE facility_id = ? AND status = 'hand_hygiene' ORDER BY created_at DESC",
    [facilityId]
  );

  const parsed: HhSessionRecord[] = [];
  for (const r of rows) {
    try {
      const obj = JSON.parse(r.payload) as HhSessionRecord & { record_type?: string };
      if (obj && obj.sessionInfo) {
        parsed.push({
          sessionInfo: {
            ...obj.sessionInfo,
            sessionId: obj.sessionInfo.sessionId || r.legacy_id || r.id,
          },
          professionals: Array.isArray(obj.professionals) ? obj.professionals : [],
        });
      }
    } catch {
      // ignore invalid
    }
  }
  return resequenceHhSessions(parsed);
}

async function upsertHhSessionUnified(
  facilityId: string,
  record: HhSessionRecord,
  createdBy = 'system',
  execDb: DbExecutor = db
): Promise<string> {
  const sid = String(record.sessionInfo.sessionId || `hh-${crypto.randomUUID().slice(0, 8)}`);
  const sDate = String(record.sessionInfo.date || new Date().toISOString().slice(0, 10));
  const deptName = String(record.sessionInfo.department || 'عام').trim();

  const deptRow = await execDb.get<{ id: string }>(
    'SELECT id FROM facility_departments WHERE facility_id = ? AND trim(name) = ? LIMIT 1',
    [facilityId, deptName]
  );
  const fallbackDept = await execDb.get<{ id: string }>(
    'SELECT id FROM facility_departments WHERE facility_id = ? LIMIT 1',
    [facilityId]
  );
  const deptId = deptRow?.id || fallbackDept?.id || 'unassigned';

  const normalized: HhSessionRecord & { record_type: 'hand_hygiene' } = {
    record_type: 'hand_hygiene',
    sessionInfo: {
      ...record.sessionInfo,
      sessionId: sid,
      date: sDate,
      department: deptName,
    },
    professionals: Array.isArray(record.professionals) ? record.professionals : [],
  };

  const existing = await execDb.get<{ id: string }>(
    "SELECT id FROM module_three_records WHERE facility_id = ? AND status = 'hand_hygiene' AND (legacy_id = ? OR id = ? OR json_extract(payload, '$.sessionInfo.sessionId') = ?) LIMIT 1",
    [facilityId, sid, sid, sid]
  );

  if (existing) {
    await execDb.run(
      'UPDATE module_three_records SET department_id = ?, payload = ?, created_at = ? WHERE id = ? AND facility_id = ?',
      [deptId, JSON.stringify(normalized), `${sDate}T10:00:00.000Z`, existing.id, facilityId]
    );
  } else {
    await execDb.run(
      `INSERT INTO module_three_records
         (id, facility_id, department_id, legacy_id, created_by, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `m3-${crypto.randomUUID()}`,
        facilityId,
        deptId,
        sid,
        createdBy,
        JSON.stringify(normalized),
        'hand_hygiene',
        `${sDate}T10:00:00.000Z`,
      ]
    );
  }
  return sid;
}

// ============================================================================
// 7. EXPRESS APP & AUTH MIDDLEWARE
// ============================================================================
const app = express();
app.use(express.json({ limit: '25mb' }));

function asyncRoute<TReq extends Request = Request>(
  handler: (req: TReq, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req as TReq, res, next)).catch(next);
  };
}

app.use('/api', async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    await ensureDbReady();
    next();
  } catch (err) {
    next(err);
  }
});

app.get(
  '/api/health',
  asyncRoute(async (_req: Request, res: Response) => {
    const latency_ms = await db.ping();
    res.json({
      ok: true,
      provider: dbMeta.provider,
      isTursoRemote: dbMeta.isTursoRemote,
      isVercel: dbMeta.isVercel,
      latency_ms,
    });
  })
);

interface AuthedRequest extends Request {
  auth?: {
    id: string;
    name: string;
    email: string;
    role: 'super_admin' | 'facility_staff';
    facility_id: string | null;
  };
}

async function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    if (!token) {
      res.status(401).json({ error: 'غير مصرح بالوصول. يرجى تسجيل الدخول أولاً.' });
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: 'انتهت صلاحية الجلسة. يرجى إعادة تسجيل الدخول.' });
      return;
    }
    const user = await db.get<AuthedRequest['auth']>(
      'SELECT id, name, email, role, facility_id FROM users WHERE id = ?',
      [payload.uid]
    );
    if (!user) {
      res.status(401).json({ error: 'المستخدم غير موجود.' });
      return;
    }
    req.auth = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function resolveAuthorizedFacility(
  req: AuthedRequest,
  res: Response,
  requestedFacilityId: string
): Promise<string | null> {
  const user = req.auth!;
  if (user.role === 'facility_staff') {
    if (!user.facility_id) {
      res.status(403).json({ error: 'حسابك غير مرتبط بمركز طبي.' });
      return null;
    }
    if (requestedFacilityId && requestedFacilityId !== user.facility_id) {
      res.status(403).json({ error: 'صلاحياتك مقيدة بمركزك الطبي فقط ولا يمكنك الوصول لبيانات مركز آخر.' });
      return null;
    }
    return user.facility_id;
  }
  const facility = await db.get<{ id: string }>('SELECT id FROM facilities WHERE id = ?', [
    requestedFacilityId,
  ]);
  if (!facility) {
    res.status(404).json({ error: 'المركز الطبي غير موجود.' });
    return null;
  }
  return facility.id;
}

function requireSuperAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.auth?.role !== 'super_admin') {
    res.status(403).json({ error: 'هذه الصلاحية متاحة للمشرف العام فقط.' });
    return;
  }
  next();
}

// ============================================================================
// 8. PUBLIC & AUTH ROUTES
// ============================================================================
app.get(
  '/api/public/facilities',
  asyncRoute(async (_req: Request, res: Response) => {
    const rows = await db.all(
      'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities ORDER BY created_at ASC'
    );
    res.json(rows);
  })
);

async function createFacilityRecord(
  name: string,
  code?: string,
  governorate?: string,
  rightLogoUrl?: string,
  leftLogoUrl?: string
) {
  const cleanName = name.trim();
  if (!cleanName) {
    return { error: 'يرجى إدخال اسم المركز الطبي.', status: 400 as const };
  }

  const dupName = await db.get('SELECT id FROM facilities WHERE trim(name) = ?', [cleanName]);
  if (dupName) {
    return { error: 'يوجد مركز طبي مسجل بهذا الاسم بالفعل.', status: 409 as const };
  }

  const finalCode = (code?.trim() || `FAC-${crypto.randomUUID().slice(0, 4)}`).toUpperCase();
  const dupCode = await db.get('SELECT id FROM facilities WHERE upper(code) = upper(?)', [finalCode]);
  if (dupCode) {
    return { error: 'كود المركز مسجل مسبقاً.', status: 409 as const };
  }

  const finalGov = governorate?.trim() || 'عام';
  const cleanRightLogo = String(rightLogoUrl || '').trim();
  const cleanLeftLogo = String(leftLogoUrl || '').trim();
  const id = `fac-${crypto.randomUUID().slice(0, 8)}`;
  const createdAt = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.run(
      'INSERT INTO facilities (id, name, code, governorate, right_logo_url, left_logo_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, cleanName, finalCode, finalGov, cleanRightLogo, cleanLeftLogo, createdAt]
    );
    await tx.run(
      'INSERT INTO facility_leaders (id, facility_id, hospital_director, quality_director, ic_supervisor, nursing_director) VALUES (?, ?, ?, ?, ?, ?)',
      [`ldr-${id}`, id, 'غير محدد', 'غير محدد', 'غير محدد', 'غير محدد']
    );
    await saveMasterSettings(
      id,
      {
        logo_url: cleanRightLogo,
        module_configs: {
          shared: {
            hospital_name: cleanName,
            right_logo_url: cleanRightLogo,
            left_logo_url: cleanLeftLogo,
          },
        },
      },
      tx
    );
    await getOrCreateModuleOneSettings(id, tx);
    await getOrCreateModuleTwoSettings(id, tx);
    await getOrCreateModuleThreeSettings(id, tx);
  });

  const created = await db.get(
    'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities WHERE id = ?',
    [id]
  );
  return { created, status: 201 as const };
}

async function updateFacilityRecord(
  facilityId: string,
  patch: { name?: string; right_logo_url?: string; left_logo_url?: string }
) {
  const existing = await db.get<{
    id: string;
    name: string;
    code: string;
    governorate: string;
    right_logo_url: string;
    left_logo_url: string;
    created_at: string;
  }>(
    'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities WHERE id = ?',
    [facilityId]
  );
  if (!existing) {
    return { error: 'المركز الطبي غير موجود.', status: 404 as const };
  }

  const nextName = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (!nextName) {
    return { error: 'يرجى إدخال اسم المركز الطبي.', status: 400 as const };
  }

  const dupName = await db.get('SELECT id FROM facilities WHERE trim(name) = ? AND id != ?', [
    nextName,
    facilityId,
  ]);
  if (dupName) {
    return { error: 'يوجد مركز طبي مسجل بهذا الاسم بالفعل.', status: 409 as const };
  }

  const nextRight =
    patch.right_logo_url !== undefined
      ? String(patch.right_logo_url).trim()
      : existing.right_logo_url || '';
  const nextLeft =
    patch.left_logo_url !== undefined
      ? String(patch.left_logo_url).trim()
      : existing.left_logo_url || '';

  await db.transaction(async (tx) => {
    await tx.run(
      'UPDATE facilities SET name = ?, right_logo_url = ?, left_logo_url = ? WHERE id = ?',
      [nextName, nextRight, nextLeft, facilityId]
    );

    await saveMasterSettings(
      facilityId,
      {
        logo_url: nextRight,
        module_configs: {
          shared: {
            hospital_name: nextName,
            right_logo_url: nextRight,
            left_logo_url: nextLeft,
          },
        },
      },
      tx
    );
    await saveModuleOneSettings(
      facilityId,
      {
        ...(patch.name !== undefined ? { hospitalName: nextName } : {}),
        rightLogoUrl: nextRight,
        leftLogoUrl: nextLeft,
      },
      tx
    );
    const m2 = await getOrCreateModuleTwoSettings(facilityId, tx);
    const nextM2Settings =
      patch.name !== undefined
        ? [
            ...m2.settings.filter((s) => s.Type !== 'Hospital_Name'),
            { ID: 'set-hosp-name', Type: 'Hospital_Name', Value: nextName },
          ]
        : m2.settings;
    await saveModuleTwoSettings(facilityId, { settings: nextM2Settings }, tx);
    const currentM3 = await getOrCreateModuleThreeSettings(facilityId, tx);
    await saveModuleThreeSettings(
      facilityId,
      {
        ...(patch.name !== undefined ? { header1: nextName } : {}),
        ...(currentM3.header2 === existing.name ? { header2: 'وحدة مكافحة العدوى' } : {}),
        logoRight: nextRight,
        logoLeft: nextLeft,
      },
      tx
    );
  });

  const updated = await db.get(
    'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities WHERE id = ?',
    [facilityId]
  );
  return { updated, status: 200 as const };
}

async function deleteFacilityRecord(facilityId: string): Promise<boolean> {
  const existing = await db.get('SELECT id FROM facilities WHERE id = ?', [facilityId]);
  if (!existing) return false;
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM users WHERE facility_id = ?', [facilityId]);
    await tx.run('DELETE FROM facilities WHERE id = ?', [facilityId]);
  });
  return true;
}

app.post(
  '/api/public/facilities',
  asyncRoute(async (req: Request, res: Response) => {
    const { name, code, governorate, right_logo_url, left_logo_url } = req.body as {
      name?: string;
      code?: string;
      governorate?: string;
      right_logo_url?: string;
      left_logo_url?: string;
    };
    const result = await createFacilityRecord(name || '', code, governorate, right_logo_url, left_logo_url);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json(result.created);
  })
);

app.put(
  '/api/public/facilities/:id',
  asyncRoute(async (req: Request, res: Response) => {
    const { name, right_logo_url, left_logo_url } = req.body as {
      name?: string;
      right_logo_url?: string;
      left_logo_url?: string;
    };
    const result = await updateFacilityRecord(req.params.id, { name, right_logo_url, left_logo_url });
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.updated);
  })
);

app.delete(
  '/api/public/facilities/:id',
  asyncRoute(async (req: Request, res: Response) => {
    const deleted = await deleteFacilityRecord(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'المركز الطبي غير موجود.' });
      return;
    }
    res.json({ deleted: true });
  })
);

app.post(
  '/api/auth/login-facility',
  asyncRoute(async (req: Request, res: Response) => {
    const { facility_id, facility_name } = req.body as {
      facility_id?: string;
      facility_name?: string;
    };

    let facility:
      | { id: string; name: string; code: string; governorate: string; created_at: string }
      | undefined;

    if (facility_id?.trim()) {
      facility = await db.get<typeof facility>(
        'SELECT id, name, code, governorate, created_at FROM facilities WHERE id = ?',
        [facility_id.trim()]
      );
    } else if (facility_name?.trim()) {
      facility = await db.get<typeof facility>(
        'SELECT id, name, code, governorate, created_at FROM facilities WHERE trim(name) = ?',
        [facility_name.trim()]
      );
    } else {
      res.status(400).json({ error: 'يرجى إدخال اسم المركز أو اختياره من القائمة.' });
      return;
    }

    if (!facility) {
      res.status(404).json({ error: 'لم يتم العثور على مركز بهذا الاسم. يمكنك إضافته كمركز جديد.' });
      return;
    }

    let userRow = await db.get<{
      id: string;
      name: string;
      email: string;
      role: 'super_admin' | 'facility_staff';
      facility_id: string | null;
      created_at: string;
    }>(
      "SELECT id, name, email, role, facility_id, created_at FROM users WHERE role = 'super_admin' ORDER BY created_at ASC LIMIT 1"
    );

    if (!userRow) {
      const newAdminId = 'usr-admin-01';
      const nowIso = new Date().toISOString();
      await db.run(
        'INSERT OR IGNORE INTO users (id, name, email, password_hash, role, facility_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          newAdminId,
          'المشرف العام',
          'admin@medhub.gov',
          hashPassword('Admin@1234'),
          'super_admin',
          null,
          nowIso,
        ]
      );
      userRow = await db.get<typeof userRow>(
        "SELECT id, name, email, role, facility_id, created_at FROM users WHERE role = 'super_admin' ORDER BY created_at ASC LIMIT 1"
      );
    }

    if (!userRow) {
      res.status(500).json({ error: 'تعذر تجهيز جلسة الدخول للمركز.' });
      return;
    }

    const facilities = await db.all(
      'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities ORDER BY created_at ASC'
    );

    const token = signToken({
      uid: userRow.id,
      role: userRow.role,
      facility_id: userRow.facility_id,
      exp: Date.now() + 1000 * 60 * 60 * 12,
    });

    res.json({
      token,
      user: {
        ...userRow,
        name: facility.name,
      },
      facilities,
      active_facility_id: facility.id,
      active_facility_name: facility.name,
    });
  })
);

app.post(
  '/api/auth/login',
  asyncRoute(async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.' });
      return;
    }
    const userRow = await db.get<{
      id: string;
      name: string;
      email: string;
      password_hash: string;
      role: 'super_admin' | 'facility_staff';
      facility_id: string | null;
      created_at: string;
    }>('SELECT id, name, email, password_hash, role, facility_id, created_at FROM users WHERE lower(email) = lower(?)', [
      email.trim(),
    ]);

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
      return;
    }

    const facilities =
      userRow.role === 'super_admin'
        ? await db.all(
            'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities ORDER BY created_at ASC'
          )
        : await db.all(
            'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities WHERE id = ?',
            [userRow.facility_id]
          );

    const defaultFacility = (facilities[0] as { id: string; name: string } | undefined) || null;
    if (!defaultFacility) {
      res.status(403).json({ error: 'لا توجد مراكز طبية متاحة لهذا الحساب.' });
      return;
    }

    const token = signToken({
      uid: userRow.id,
      role: userRow.role,
      facility_id: userRow.facility_id,
      exp: Date.now() + 1000 * 60 * 60 * 12,
    });

    res.json({
      token,
      user: {
        id: userRow.id,
        name: userRow.name,
        email: userRow.email,
        role: userRow.role,
        facility_id: userRow.facility_id,
        created_at: userRow.created_at,
      },
      facilities,
      active_facility_id: defaultFacility.id,
      active_facility_name: defaultFacility.name,
    });
  })
);

app.get(
  '/api/auth/me',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const user = req.auth!;
    const facilities =
      user.role === 'super_admin'
        ? await db.all(
            'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities ORDER BY created_at ASC'
          )
        : await db.all(
            'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities WHERE id = ?',
            [user.facility_id]
          );

    const userFull = await db.get(
      'SELECT id, name, email, role, facility_id, created_at FROM users WHERE id = ?',
      [user.id]
    );

    if (!userFull) {
      res.status(401).json({ error: 'المستخدم غير موجود.' });
      return;
    }

    res.json({ user: userFull, facilities });
  })
);

// ============================================================================
// 9. FACILITIES & USERS ADMIN
// ============================================================================
app.get(
  '/api/facilities',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const user = req.auth!;
    const rows =
      user.role === 'super_admin'
        ? await db.all(
            'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities ORDER BY created_at ASC'
          )
        : await db.all(
            'SELECT id, name, code, governorate, right_logo_url, left_logo_url, created_at FROM facilities WHERE id = ?',
            [user.facility_id]
          );
    res.json(rows);
  })
);

app.post(
  '/api/facilities',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const { name, code, governorate, right_logo_url, left_logo_url } = req.body as {
      name?: string;
      code?: string;
      governorate?: string;
      right_logo_url?: string;
      left_logo_url?: string;
    };
    const result = await createFacilityRecord(name || '', code, governorate, right_logo_url, left_logo_url);
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(201).json(result.created);
  })
);

app.put(
  '/api/facilities/:id',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const { name, right_logo_url, left_logo_url } = req.body as {
      name?: string;
      right_logo_url?: string;
      left_logo_url?: string;
    };
    const result = await updateFacilityRecord(req.params.id, { name, right_logo_url, left_logo_url });
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json(result.updated);
  })
);

app.delete(
  '/api/facilities/:id',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const deleted = await deleteFacilityRecord(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'المركز الطبي غير موجود.' });
      return;
    }
    res.json({ deleted: true });
  })
);

app.get(
  '/api/admin/users',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (_req, res) => {
    const users = await db.all(
      'SELECT id, name, email, role, facility_id, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(users);
  })
);

app.post(
  '/api/admin/users',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const { name, email, password, role, facility_id } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: 'super_admin' | 'facility_staff';
      facility_id?: string | null;
    };
    if (!name?.trim() || !email?.trim() || !password || !role) {
      res.status(400).json({ error: 'جميع حقول المستخدم مطلوبة.' });
      return;
    }
    if (role === 'facility_staff' && !facility_id) {
      res.status(400).json({ error: 'يجب تحديد المركز الطبي لحساب الموظف.' });
      return;
    }
    const exists = await db.get('SELECT id FROM users WHERE lower(email) = lower(?)', [email.trim()]);
    if (exists) {
      res.status(409).json({ error: 'البريد الإلكتروني مستخدم بالفعل.' });
      return;
    }
    const id = `usr-${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();
    await db.run(
      'INSERT INTO users (id, name, email, password_hash, role, facility_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        name.trim(),
        email.trim().toLowerCase(),
        hashPassword(password),
        role,
        role === 'super_admin' ? null : facility_id!,
        createdAt,
      ]
    );
    const created = await db.get('SELECT id, name, email, role, facility_id, created_at FROM users WHERE id = ?', [
      id,
    ]);
    res.status(201).json(created);
  })
);

app.patch(
  '/api/admin/users/:id',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const { id } = req.params;
    const { name, role, facility_id } = req.body as {
      name?: string;
      role?: 'super_admin' | 'facility_staff';
      facility_id?: string | null;
    };
    const existing = await db.get('SELECT id FROM users WHERE id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'المستخدم غير موجود.' });
      return;
    }
    if (role === 'facility_staff' && !facility_id) {
      res.status(400).json({ error: 'يجب ربط موظف المركز بمركز طبي محدد.' });
      return;
    }
    await db.run('UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), facility_id = ? WHERE id = ?', [
      name?.trim() || null,
      role || null,
      role === 'super_admin' ? null : facility_id || null,
      id,
    ]);
    const updated = await db.get('SELECT id, name, email, role, facility_id, created_at FROM users WHERE id = ?', [
      id,
    ]);
    res.json(updated);
  })
);

// ============================================================================
// 10. UNIFIED MASTER DATA & SETTINGS (STRICT WHERE facility_id = ?)
// ============================================================================
app.get(
  '/api/facilities/:facilityId/master-data',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const settings = await getOrCreateMasterSettings(facilityId);
    const leaders = {
      id: `ldr-${facilityId}`,
      facility_id: facilityId,
      hospital_director: settings.hospital_director,
      quality_director: settings.quality_director,
      ic_supervisor: settings.ic_supervisor,
      nursing_director: settings.nursing_director,
    };
    const departments = await db.all(
      'SELECT id, facility_id, name, type FROM facility_departments WHERE facility_id = ? ORDER BY name ASC',
      [facilityId]
    );
    const staff = await db.all(
      'SELECT id, facility_id, name, employee_code, category, department_id FROM facility_staff WHERE facility_id = ? ORDER BY name ASC',
      [facilityId]
    );

    res.json({ leaders, settings, departments, staff });
  })
);

app.put(
  '/api/facilities/:facilityId/leaders',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { hospital_director, quality_director, ic_supervisor, nursing_director } = req.body as {
      hospital_director?: string;
      quality_director?: string;
      ic_supervisor?: string;
      nursing_director?: string;
    };

    const saved = await saveMasterSettings(facilityId, {
      hospital_director,
      quality_director,
      ic_supervisor,
      nursing_director,
    });

    res.json({
      id: `ldr-${facilityId}`,
      facility_id: facilityId,
      hospital_director: saved.hospital_director,
      quality_director: saved.quality_director,
      ic_supervisor: saved.ic_supervisor,
      nursing_director: saved.nursing_director,
    });
  })
);

app.put(
  '/api/facilities/:facilityId/master-settings',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const body = req.body as {
      hospital_director?: string;
      quality_director?: string;
      ic_supervisor?: string;
      nursing_director?: string;
      logo_url?: string;
      module_configs?: Partial<ModuleConfigsJson>;
    };

    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'بيانات الإعدادات غير صالحة.' });
      return;
    }

    const saved = await saveMasterSettings(facilityId, body);
    res.json(saved);
  })
);

app.post(
  '/api/facilities/:facilityId/departments',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { name, type } = req.body as { name?: string; type?: string };
    if (!name?.trim() || !type?.trim()) {
      res.status(400).json({ error: 'اسم القسم ونوعه مطلوبان.' });
      return;
    }
    const dup = await db.get('SELECT id FROM facility_departments WHERE facility_id = ? AND name = ?', [
      facilityId,
      name.trim(),
    ]);
    if (dup) {
      res.status(409).json({ error: 'اسم القسم موجود بالفعل في هذا المركز.' });
      return;
    }
    const id = `dep-${crypto.randomUUID().slice(0, 8)}`;
    await db.run('INSERT INTO facility_departments (id, facility_id, name, type) VALUES (?, ?, ?, ?)', [
      id,
      facilityId,
      name.trim(),
      type.trim(),
    ]);
    const row = await db.get('SELECT * FROM facility_departments WHERE id = ? AND facility_id = ?', [id, facilityId]);
    res.status(201).json(row);
  })
);

app.patch(
  '/api/facilities/:facilityId/departments/:id',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { name, type } = req.body as { name?: string; type?: string };
    const result = await db.run(
      'UPDATE facility_departments SET name = COALESCE(?, name), type = COALESCE(?, type) WHERE id = ? AND facility_id = ?',
      [name?.trim() || null, type?.trim() || null, req.params.id, facilityId]
    );
    if (result.changes === 0) {
      res.status(404).json({ error: 'القسم غير موجود بهذا المركز.' });
      return;
    }
    const updated = await db.get('SELECT * FROM facility_departments WHERE id = ? AND facility_id = ?', [
      req.params.id,
      facilityId,
    ]);
    res.json(updated);
  })
);

app.delete(
  '/api/facilities/:facilityId/departments/:id',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const result = await db.run('DELETE FROM facility_departments WHERE id = ? AND facility_id = ?', [
      req.params.id,
      facilityId,
    ]);
    if (result.changes === 0) {
      res.status(404).json({ error: 'القسم غير موجود.' });
      return;
    }
    res.json({ deleted: true });
  })
);

app.post(
  '/api/facilities/:facilityId/staff',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { name, employee_code, category, department_id } = req.body as {
      name?: string;
      employee_code?: string;
      category?: string;
      department_id?: string;
    };
    if (!name?.trim() || !employee_code?.trim() || !category?.trim() || !department_id) {
      res.status(400).json({ error: 'جميع بيانات الموظف مطلوبة.' });
      return;
    }
    const dept = await db.get('SELECT id FROM facility_departments WHERE id = ? AND facility_id = ?', [
      department_id,
      facilityId,
    ]);
    if (!dept) {
      res.status(400).json({ error: 'القسم المحدد لا يتبع هذا المركز.' });
      return;
    }
    const dup = await db.get(
      'SELECT id FROM facility_staff WHERE facility_id = ? AND upper(employee_code) = upper(?)',
      [facilityId, employee_code.trim()]
    );
    if (dup) {
      res.status(409).json({ error: 'الكود الوظيفي مسجل مسبقاً في هذا المركز.' });
      return;
    }
    const id = `stf-${crypto.randomUUID().slice(0, 8)}`;
    await db.run(
      'INSERT INTO facility_staff (id, facility_id, name, employee_code, category, department_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, facilityId, name.trim(), employee_code.trim().toUpperCase(), category.trim(), department_id]
    );
    const created = await db.get('SELECT * FROM facility_staff WHERE id = ? AND facility_id = ?', [id, facilityId]);
    res.status(201).json(created);
  })
);

app.patch(
  '/api/facilities/:facilityId/staff/:id',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { name, employee_code, category, department_id } = req.body as {
      name?: string;
      employee_code?: string;
      category?: string;
      department_id?: string;
    };
    if (department_id) {
      const dept = await db.get('SELECT id FROM facility_departments WHERE id = ? AND facility_id = ?', [
        department_id,
        facilityId,
      ]);
      if (!dept) {
        res.status(400).json({ error: 'القسم المحدد لا يتبع هذا المركز.' });
        return;
      }
    }
    const result = await db.run(
      `UPDATE facility_staff
       SET name = COALESCE(?, name),
           employee_code = COALESCE(?, employee_code),
           category = COALESCE(?, category),
           department_id = COALESCE(?, department_id)
       WHERE id = ? AND facility_id = ?`,
      [
        name?.trim() || null,
        employee_code?.trim().toUpperCase() || null,
        category?.trim() || null,
        department_id || null,
        req.params.id,
        facilityId,
      ]
    );
    if (result.changes === 0) {
      res.status(404).json({ error: 'الموظف غير موجود.' });
      return;
    }
    const updated = await db.get('SELECT * FROM facility_staff WHERE id = ? AND facility_id = ?', [
      req.params.id,
      facilityId,
    ]);
    res.json(updated);
  })
);

app.delete(
  '/api/facilities/:facilityId/staff/:id',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const result = await db.run('DELETE FROM facility_staff WHERE id = ? AND facility_id = ?', [
      req.params.id,
      facilityId,
    ]);
    if (result.changes === 0) {
      res.status(404).json({ error: 'الموظف غير موجود.' });
      return;
    }
    res.json({ deleted: true });
  })
);

// ============================================================================
// 11. OVERVIEW AGGREGATION (FROM UNIFIED SCHEMA TABLES ONLY)
// ============================================================================
app.get(
  '/api/facilities/:facilityId/overview',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const staffCountRow = await db.get<{ c: number }>(
      'SELECT COUNT(*) as c FROM facility_staff WHERE facility_id = ?',
      [facilityId]
    );
    const staffCount = Number(staffCountRow?.c || 0);
    const departments = await db.all<{ id: string; name: string }>(
      'SELECT id, name FROM facility_departments WHERE facility_id = ? ORDER BY name ASC',
      [facilityId]
    );

    const m1Counts = await db.all<{ status: string; c: number }>(
      "SELECT status, COUNT(*) as c FROM module_one_records WHERE facility_id = ? AND json_extract(payload, '$.report_type') = 'weekly_round' GROUP BY status",
      [facilityId]
    );

    const m1Map = new Map(m1Counts.map((r) => [r.status, Number(r.c || 0)]));
    const trainingCompleted = m1Map.get('completed') || 0;
    const trainingPending = m1Map.get('pending') || 0;
    const trainingInProgress = m1Map.get('in_progress') || 0;

    const m2Bundle = await buildTrainingBundleFromUnifiedDb(facilityId);
    const trainingLogs = m2Bundle.logs;
    const trainingPlan = m2Bundle.plan;
    const uniqueSessions = new Set(
      trainingLogs.map(
        (l) => `${String(l.Date || '').split('T')[0]}||${l.Category || ''}||${l.Policies || ''}||${l.Trainer || ''}`
      )
    ).size;
    const uniqueTrainees = new Set(
      trainingLogs.map((l) => String(l.TraineeName || '').trim()).filter(Boolean)
    ).size;

    const hhSessions = await getFacilityHhSessions(facilityId);
    let hhTotalOpportunities = 0;
    let hhCompliantActions = 0;
    const hhDeptStats = new Map<string, { opp: number; act: number }>();

    for (const s of hhSessions) {
      const deptName = String(s.sessionInfo?.department || '').trim();
      const deptBucket = deptName ? hhDeptStats.get(deptName) || { opp: 0, act: 0 } : null;
      for (const prof of s.professionals || []) {
        for (const opp of prof.opportunities || []) {
          const hasObs = (opp.indications && opp.indications.length > 0) || Boolean(opp.action);
          if (!hasObs) continue;
          hhTotalOpportunities++;
          const isCompliant = opp.action === 'HR' || opp.action === 'HW';
          if (isCompliant) hhCompliantActions++;
          if (deptBucket) {
            deptBucket.opp++;
            if (isCompliant) deptBucket.act++;
          }
        }
      }
      if (deptName && deptBucket) {
        hhDeptStats.set(deptName, deptBucket);
      }
    }

    const hhOverallRate =
      hhTotalOpportunities > 0 ? Math.round((hhCompliantActions / hhTotalOpportunities) * 100) : 0;

    res.json({
      facility_id: facilityId,
      staff_count: staffCount,
      departments_count: departments.length,
      training_total: trainingCompleted + trainingPending + trainingInProgress,
      training_completed: trainingCompleted,
      training_pending: trainingPending,
      training_in_progress: trainingInProgress,
      observations_total: trainingLogs.length,
      observations_open: uniqueSessions,
      observations_in_progress: uniqueTrainees,
      observations_closed: trainingPlan.length,
      compliance_total: hhTotalOpportunities,
      avg_compliance_rate: hhOverallRate,
      department_compliance: departments.map((d) => {
        const ds = hhDeptStats.get(d.name.trim());
        const rate = ds && ds.opp > 0 ? Math.round((ds.act / ds.opp) * 100) : 0;
        return {
          department_id: d.id,
          department_name: d.name,
          compliance_rate: rate,
          observations_open: 0,
        };
      }),
    });
  })
);

// ============================================================================
// 12. GENERIC MODULE CRUD (STRICT WHERE facility_id = ?)
// ============================================================================
const MODULE_TABLE_MAP: Record<string, string> = {
  module_one: 'module_one_records',
  module_two: 'module_two_records',
  module_three: 'module_three_records',
};

function parseRecordRow(row: Record<string, unknown>) {
  return {
    ...row,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
  };
}

app.get(
  '/api/facilities/:facilityId/modules/:moduleKey',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const table = MODULE_TABLE_MAP[req.params.moduleKey];
    if (!table) {
      res.status(400).json({ error: 'معرف الموديول غير صالح.' });
      return;
    }

    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE facility_id = ? ORDER BY created_at DESC`,
      [facilityId]
    );
    res.json(rows.map(parseRecordRow));
  })
);

app.post(
  '/api/facilities/:facilityId/modules/:moduleKey',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const moduleKey = req.params.moduleKey;
    const table = MODULE_TABLE_MAP[moduleKey];
    if (!table) {
      res.status(400).json({ error: 'معرف الموديول غير صالح.' });
      return;
    }

    const { staff_id, department_id, payload, status, legacy_id } = req.body as {
      staff_id?: string;
      department_id?: string;
      payload?: Record<string, unknown>;
      status?: string;
      legacy_id?: string;
    };

    if (!department_id || !payload || !status) {
      res.status(400).json({ error: 'البيانات الأساسية للسجل غير مكتملة.' });
      return;
    }

    const id = `${moduleKey === 'module_one' ? 'm1' : moduleKey === 'module_two' ? 'm2' : 'm3'}-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const createdBy = req.auth!.id;

    if (moduleKey === 'module_one') {
      if (!staff_id) {
        res.status(400).json({ error: 'يجب تحديد الموظف لسجل التقييم.' });
        return;
      }
      await db.run(
        `INSERT INTO module_one_records (id, facility_id, staff_id, department_id, legacy_id, created_by, payload, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, facilityId, staff_id, department_id, legacy_id || null, createdBy, JSON.stringify(payload), status, createdAt]
      );
    } else {
      await db.run(
        `INSERT INTO ${table} (id, facility_id, department_id, legacy_id, created_by, payload, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, facilityId, department_id, legacy_id || null, createdBy, JSON.stringify(payload), status, createdAt]
      );
    }

    const created = await db.get<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id = ? AND facility_id = ?`,
      [id, facilityId]
    );
    res.status(201).json(parseRecordRow(created!));
  })
);

app.patch(
  '/api/facilities/:facilityId/modules/:moduleKey/:recordId',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const moduleKey = req.params.moduleKey;
    const table = MODULE_TABLE_MAP[moduleKey];
    if (!table) {
      res.status(400).json({ error: 'معرف الموديول غير صالح.' });
      return;
    }

    const { staff_id, department_id, payload, status } = req.body as {
      staff_id?: string;
      department_id?: string;
      payload?: Record<string, unknown>;
      status?: string;
    };

    const existing = await db.get<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id = ? AND facility_id = ?`,
      [req.params.recordId, facilityId]
    );
    if (!existing) {
      res.status(404).json({ error: 'السجل غير موجود في هذا المركز.' });
      return;
    }

    const mergedPayload = payload
      ? { ...(typeof existing.payload === 'string' ? JSON.parse(existing.payload) : existing.payload), ...payload }
      : typeof existing.payload === 'string'
        ? JSON.parse(existing.payload)
        : existing.payload;

    if (moduleKey === 'module_one') {
      await db.run(
        `UPDATE module_one_records
         SET staff_id = COALESCE(?, staff_id),
             department_id = COALESCE(?, department_id),
             payload = ?,
             status = COALESCE(?, status)
         WHERE id = ? AND facility_id = ?`,
        [staff_id || null, department_id || null, JSON.stringify(mergedPayload), status || null, req.params.recordId, facilityId]
      );
    } else {
      await db.run(
        `UPDATE ${table}
         SET department_id = COALESCE(?, department_id),
             payload = ?,
             status = COALESCE(?, status)
         WHERE id = ? AND facility_id = ?`,
        [department_id || null, JSON.stringify(mergedPayload), status || null, req.params.recordId, facilityId]
      );
    }

    const updated = await db.get<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id = ? AND facility_id = ?`,
      [req.params.recordId, facilityId]
    );
    res.json(parseRecordRow(updated!));
  })
);

app.delete(
  '/api/facilities/:facilityId/modules/:moduleKey/:recordId',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const table = MODULE_TABLE_MAP[req.params.moduleKey];
    if (!table) {
      res.status(400).json({ error: 'معرف الموديول غير صالح.' });
      return;
    }

    const result = await db.run(`DELETE FROM ${table} WHERE id = ? AND facility_id = ?`, [
      req.params.recordId,
      facilityId,
    ]);
    if (result.changes === 0) {
      res.status(404).json({ error: 'السجل غير موجود.' });
      return;
    }
    res.json({ deleted: true });
  })
);

// ============================================================================
// 13. SMART 2-PHASE DATA MIGRATION TOOL (SQLite .db + JSON, UUID + DEDUP)
// ============================================================================
type MigrationTargetDestination =
  | 'leaders'
  | 'module_one_settings'
  | 'module_two_settings'
  | 'module_three_settings'
  | 'departments'
  | 'staff'
  | 'module_one'
  | 'module_two'
  | 'module_three'
  | 'ignore';

interface SmartMigrationTableEntry {
  sourceTable: string;
  target: MigrationTargetDestination;
  rows: Array<Record<string, unknown>>;
}

function pickStr(row: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return String(row[k]).trim();
    }
  }
  const lowerMap = new Map<string, unknown>();
  for (const [rk, rv] of Object.entries(row)) {
    lowerMap.set(rk.toLowerCase().trim(), rv);
  }
  for (const k of keys) {
    const val = lowerMap.get(k.toLowerCase());
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return fallback;
}

function parseJsonOrArrayField(val: unknown): unknown {
  if (typeof val !== 'string') return val;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return val;
    }
  }
  return val;
}

async function executeSmartMigration(
  facilityId: string,
  tables: SmartMigrationTableEntry[],
  createdBy: string
) {
  const summary = {
    departments_upserted: 0,
    staff_upserted: 0,
    leaders_updated: 0,
    module_one_settings_updated: 0,
    module_two_settings_updated: 0,
    module_three_settings_updated: 0,
    settings_updated: 0,
    module_one_upserted: 0,
    module_two_upserted: 0,
    module_three_upserted: 0,
    duplicates_skipped: 0,
  };

  const deptByName = new Map<string, string>();
  const deptByLegacyId = new Map<string, string>();
  const existingDepts = await db.all<{ id: string; name: string }>(
    'SELECT id, name FROM facility_departments WHERE facility_id = ?',
    [facilityId]
  );
  for (const d of existingDepts) {
    deptByName.set(d.name.trim().toLowerCase(), d.id);
    deptByLegacyId.set(d.id, d.id);
  }

  const staffByCode = new Map<string, string>();
  const staffByName = new Map<string, string>();
  const staffByLegacyId = new Map<string, string>();
  const existingStaff = await db.all<{ id: string; name: string; employee_code: string }>(
    'SELECT id, name, employee_code FROM facility_staff WHERE facility_id = ?',
    [facilityId]
  );
  for (const s of existingStaff) {
    staffByCode.set(s.employee_code.trim().toUpperCase(), s.id);
    staffByName.set(s.name.trim().toLowerCase(), s.id);
    staffByLegacyId.set(s.id, s.id);
  }

  await db.transaction(async (tx) => {
    const ensureFallbackDeptId = async (): Promise<string> => {
      const existing = Array.from(deptByName.values())[0];
      if (existing) return existing;
      const newId = `dep-${crypto.randomUUID()}`;
      await tx.run('INSERT INTO facility_departments (id, facility_id, name, type) VALUES (?, ?, ?, ?)', [
        newId,
        facilityId,
        'قسم عام مرحل',
        'إكلينيكي',
      ]);
      deptByName.set('قسم عام مرحل', newId);
      summary.departments_upserted++;
      return newId;
    };

    // ------------------------------------------------------------------------
    // PHASE 1: MASTER DATA & ISOLATED PER-MODULE SETTINGS FIRST
    // ------------------------------------------------------------------------
    // 1A. Leaders
    for (const entry of tables.filter((t) => t.target === 'leaders')) {
      for (const row of entry.rows) {
        const hospital_director = pickStr(row, ['hospital_director', 'hospitalDirector', 'Hospital_Manager_Name', 'managerSignature']);
        const quality_director = pickStr(row, ['quality_director', 'qualityDirector']);
        const ic_supervisor = pickStr(row, ['ic_supervisor', 'icSupervisor', 'IC_Manager_Name', 'teamSignature']);
        const nursing_director = pickStr(row, ['nursing_director', 'nursingDirector']);
        if (hospital_director || quality_director || ic_supervisor || nursing_director) {
          await saveMasterSettings(
            facilityId,
            {
              ...(hospital_director ? { hospital_director } : {}),
              ...(quality_director ? { quality_director } : {}),
              ...(ic_supervisor ? { ic_supervisor } : {}),
              ...(nursing_director ? { nursing_director } : {}),
            },
            tx
          );
          summary.leaders_updated++;
        }
      }
    }

    // 1B-1. Module One Settings (تقارير المرور)
    for (const entry of tables.filter((t) => t.target === 'module_one_settings')) {
      const next = await getOrCreateModuleOneSettings(facilityId, tx);
      let touched = false;

      const absorbM1Object = (obj: Record<string, unknown>) => {
        const hName = pickStr(obj, ['hospitalName', 'hospital_name']);
        const tSig = pickStr(obj, ['teamSignature', 'team_signature', 'ic_supervisor']);
        const mSig = pickStr(obj, ['managerSignature', 'manager_signature', 'hospital_director']);
        const rLogo = pickStr(obj, ['rightLogoUrl', 'right_logo_url', 'logoRight']);
        const lLogo = pickStr(obj, ['leftLogoUrl', 'left_logo_url', 'logoLeft']);
        if (hName) { next.hospitalName = hName; touched = true; }
        if (tSig) { next.teamSignature = tSig; touched = true; }
        if (mSig) { next.managerSignature = mSig; touched = true; }
        if (rLogo) { next.rightLogoUrl = rLogo; touched = true; }
        if (lLogo) { next.leftLogoUrl = lLogo; touched = true; }

        const deptsVal = parseJsonOrArrayField(obj.departments);
        if (Array.isArray(deptsVal)) {
          next.departments = Array.from(new Set([...next.departments, ...deptsVal.map(String).filter(Boolean)]));
          touched = true;
        }
        const periodsVal = parseJsonOrArrayField(obj.periods);
        if (Array.isArray(periodsVal) && periodsVal.length > 0) {
          next.periods = Array.from(new Set(periodsVal.map(String).filter(Boolean)));
          touched = true;
        }
        const inspVal = parseJsonOrArrayField(obj.inspectors);
        if (Array.isArray(inspVal)) {
          next.inspectors = Array.from(new Set([...next.inspectors, ...inspVal.map(String).filter(Boolean)]));
          touched = true;
        }
        const implVal = parseJsonOrArrayField(obj.implementers);
        if (Array.isArray(implVal)) {
          next.implementers = Array.from(new Set([...next.implementers, ...implVal.map(String).filter(Boolean)]));
          touched = true;
        }
        const procsVal = parseJsonOrArrayField(obj.procedures);
        if (Array.isArray(procsVal) && procsVal.length > 0) {
          next.procedures = procsVal as ReportProcedureConfig[];
          touched = true;
        }
      };

      for (const row of entry.rows) {
        const rawJson = row.settings_json ?? row.payload ?? row.data_json;
        if (rawJson !== undefined) {
          const parsed = parseJsonOrArrayField(rawJson);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            absorbM1Object(parsed as Record<string, unknown>);
          }
        }
        const sType = pickStr(row, ['Type', 'type', 'key', 'setting_key']);
        const sVal = pickStr(row, ['Value', 'value', 'val', 'setting_value']);
        if (sType && sVal) {
          touched = true;
          if (sType === 'hospitalName' || sType === 'Hospital_Name') next.hospitalName = sVal;
          else if (sType === 'teamSignature' || sType === 'IC_Manager_Name') next.teamSignature = sVal;
          else if (sType === 'managerSignature' || sType === 'Hospital_Manager_Name') next.managerSignature = sVal;
          else if (sType === 'rightLogoUrl' || sType === 'Hospital_Logo') next.rightLogoUrl = sVal;
          else if (sType === 'leftLogoUrl' || sType === 'Hospital_Logo_Left') next.leftLogoUrl = sVal;
          else if (sType === 'department' && !next.departments.includes(sVal)) next.departments.push(sVal);
          else if (sType === 'period' && !next.periods.includes(sVal)) next.periods.push(sVal);
          else if (sType === 'inspector' && !next.inspectors.includes(sVal)) next.inspectors.push(sVal);
          else if (sType === 'implementer' && !next.implementers.includes(sVal)) next.implementers.push(sVal);
          continue;
        }
        absorbM1Object(row);
      }

      if (touched) {
        await saveModuleOneSettings(facilityId, next, tx);
        summary.module_one_settings_updated++;
      }
    }

    // 1B-2. Module Two Settings (البرنامج التدريبي)
    for (const entry of tables.filter((t) => t.target === 'module_two_settings')) {
      const next = await getOrCreateModuleTwoSettings(facilityId, tx);
      const settingsList = [...(next.settings || [])];
      const singletonTypes = new Set([
        'Hospital_Name',
        'Hospital_Logo',
        'Hospital_Logo_Left',
        'IC_Manager_Title',
        'IC_Manager_Name',
        'Hospital_Manager_Title',
        'Hospital_Manager_Name',
      ]);
      const setSetting = (type: string, value: string) => {
        if (singletonTypes.has(type)) {
          const idx = settingsList.findIndex((s) => s.Type === type);
          if (idx >= 0) settingsList[idx] = { ...settingsList[idx], Value: value };
          else settingsList.push({ ID: `set-${crypto.randomUUID().slice(0, 8)}`, Type: type, Value: value });
        } else if (!settingsList.some((s) => s.Type === type && s.Value.trim() === value.trim())) {
          settingsList.push({ ID: `set-${crypto.randomUUID().slice(0, 8)}`, Type: type, Value: value });
        }
      };

      let categories = [...(next.categories || [])];
      let employees = Array.isArray(next.employees) ? [...next.employees] : [];
      let touched = false;

      for (const row of entry.rows) {
        const rawJson = row.data_json ?? row.settings_json ?? row.payload;
        if (rawJson !== undefined) {
          const parsed = parseJsonOrArrayField(rawJson);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const pObj = parsed as Partial<ModuleTwoSettingsPayload>;
            if (Array.isArray(pObj.settings)) {
              for (const s of pObj.settings) {
                if (s?.Type && s.Value !== undefined) {
                  setSetting(String(s.Type), String(s.Value));
                  touched = true;
                }
              }
            }
            if (Array.isArray(pObj.categories)) {
              categories = Array.from(new Set([...categories, ...pObj.categories.map(String).filter(Boolean)]));
              touched = true;
            }
            if (Array.isArray(pObj.employees)) {
              for (const emp of pObj.employees) {
                if (emp?.Name && !employees.some((e) => e.Name.trim() === emp.Name.trim())) {
                  employees.push(emp);
                }
              }
              touched = true;
            }
          }
        }

        const sType = pickStr(row, ['Type', 'type', 'key', 'setting_key']);
        const sVal = pickStr(row, ['Value', 'value', 'val', 'setting_value']);
        if (sType && sVal !== '') {
          setSetting(sType, sVal);
          if (sType === 'Category' && !categories.includes(sVal)) categories.push(sVal);
          touched = true;
          continue;
        }

        const hName = pickStr(row, ['hospitalName', 'hospital_name', 'Hospital_Name']);
        const hLogo = pickStr(row, ['Hospital_Logo', 'rightLogoUrl', 'right_logo_url']);
        const hLogoLeft = pickStr(row, ['Hospital_Logo_Left', 'leftLogoUrl', 'left_logo_url']);
        const icT = pickStr(row, ['IC_Manager_Title', 'ic_manager_title']);
        const icN = pickStr(row, ['IC_Manager_Name', 'ic_supervisor']);
        const hmT = pickStr(row, ['Hospital_Manager_Title', 'hospital_manager_title']);
        const hmN = pickStr(row, ['Hospital_Manager_Name', 'hospital_director']);
        if (hName) { setSetting('Hospital_Name', hName); touched = true; }
        if (hLogo) { setSetting('Hospital_Logo', hLogo); touched = true; }
        if (hLogoLeft) { setSetting('Hospital_Logo_Left', hLogoLeft); touched = true; }
        if (icT) { setSetting('IC_Manager_Title', icT); touched = true; }
        if (icN) { setSetting('IC_Manager_Name', icN); touched = true; }
        if (hmT) { setSetting('Hospital_Manager_Title', hmT); touched = true; }
        if (hmN) { setSetting('Hospital_Manager_Name', hmN); touched = true; }

        const polVal = parseJsonOrArrayField(row.policies);
        if (Array.isArray(polVal)) {
          for (const p of polVal) if (String(p).trim()) { setSetting('Policy', String(p).trim()); touched = true; }
        }
        const trnVal = parseJsonOrArrayField(row.trainers);
        if (Array.isArray(trnVal)) {
          for (const t of trnVal) if (String(t).trim()) { setSetting('Trainer', String(t).trim()); touched = true; }
        }
        const catVal = parseJsonOrArrayField(row.categories);
        if (Array.isArray(catVal)) {
          for (const c of catVal) {
            const clean = String(c).trim();
            if (clean) {
              setSetting('Category', clean);
              if (!categories.includes(clean)) categories.push(clean);
              touched = true;
            }
          }
        }
      }

      if (touched) {
        await saveModuleTwoSettings(facilityId, { settings: settingsList, categories, employees }, tx);
        summary.module_two_settings_updated++;
      }
    }

    // 1B-3. Module Three Settings (إحصائية غسيل الأيدي)
    for (const entry of tables.filter((t) => t.target === 'module_three_settings')) {
      const next = await getOrCreateModuleThreeSettings(facilityId, tx);
      let touched = false;

      const absorbHhObj = (obj: Record<string, unknown>) => {
        const h1 = pickStr(obj, ['header1']);
        const h2 = pickStr(obj, ['header2']);
        const h3 = pickStr(obj, ['header3']);
        const lr = pickStr(obj, ['logoRight', 'rightLogoUrl', 'right_logo_url']);
        const ll = pickStr(obj, ['logoLeft', 'leftLogoUrl', 'left_logo_url']);
        if (h1) { next.header1 = h1; touched = true; }
        if (h2) { next.header2 = h2; touched = true; }
        if (h3) { next.header3 = h3; touched = true; }
        if (lr) { next.logoRight = lr; touched = true; }
        if (ll) { next.logoLeft = ll; touched = true; }

        const mergeArr = (field: 'services' | 'wards' | 'departments' | 'observers' | 'cities' | 'profCategories', raw: unknown) => {
          const parsed = parseJsonOrArrayField(raw);
          if (Array.isArray(parsed)) {
            next[field] = Array.from(new Set([...next[field], ...parsed.map(String).filter(Boolean)]));
            touched = true;
          }
        };
        mergeArr('services', obj.services);
        mergeArr('wards', obj.wards);
        mergeArr('departments', obj.departments);
        mergeArr('observers', obj.observers);
        mergeArr('cities', obj.cities);
        mergeArr('profCategories', obj.profCategories);
      };

      for (const row of entry.rows) {
        const rawJson = row.settings_json ?? row.payload ?? row.data_json;
        if (rawJson !== undefined) {
          const parsed = parseJsonOrArrayField(rawJson);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            absorbHhObj(parsed as Record<string, unknown>);
          }
        }
        const sType = pickStr(row, ['Type', 'type', 'key', 'setting_key']);
        const sVal = pickStr(row, ['Value', 'value', 'val', 'setting_value']);
        if (sType && sVal) {
          touched = true;
          if (sType === 'header1') next.header1 = sVal;
          else if (sType === 'header2') next.header2 = sVal;
          else if (sType === 'header3') next.header3 = sVal;
          else if (sType === 'logoRight') next.logoRight = sVal;
          else if (sType === 'logoLeft') next.logoLeft = sVal;
          else if (sType === 'Service' && !next.services.includes(sVal)) next.services.push(sVal);
          else if (sType === 'Ward' && !next.wards.includes(sVal)) next.wards.push(sVal);
          else if (sType === 'Department' && !next.departments.includes(sVal)) next.departments.push(sVal);
          else if (sType === 'Observer' && !next.observers.includes(sVal)) next.observers.push(sVal);
          else if (sType === 'City' && !next.cities.includes(sVal)) next.cities.push(sVal);
          else if (sType === 'ProfCategory' && !next.profCategories.includes(sVal)) next.profCategories.push(sVal);
          continue;
        }
        absorbHhObj(row);
      }

      if (touched) {
        await saveModuleThreeSettings(facilityId, next, tx);
        summary.module_three_settings_updated++;
      }
    }

    summary.settings_updated =
      summary.module_one_settings_updated +
      summary.module_two_settings_updated +
      summary.module_three_settings_updated;

    // 1C. Departments (Always generate new UUID, dedup by normalized name within facility_id)
    for (const entry of tables.filter((t) => t.target === 'departments')) {
      for (const row of entry.rows) {
        const cleanName = pickStr(row, ['name', 'Name', 'department', 'Department', 'dept_name']);
        if (!cleanName) continue;
        const legacyId = pickStr(row, ['id', 'ID', 'legacy_id']);
        const normName = cleanName.toLowerCase();
        const deptType = pickStr(row, ['type', 'Type', 'category'], 'إكلينيكي');

        const existingId = deptByName.get(normName);
        if (existingId) {
          summary.duplicates_skipped++;
          if (legacyId) deptByLegacyId.set(legacyId, existingId);
        } else {
          const newUuid = `dep-${crypto.randomUUID()}`;
          await tx.run('INSERT INTO facility_departments (id, facility_id, name, type) VALUES (?, ?, ?, ?)', [
            newUuid,
            facilityId,
            cleanName,
            deptType,
          ]);
          deptByName.set(normName, newUuid);
          if (legacyId) deptByLegacyId.set(legacyId, newUuid);
          summary.departments_upserted++;
        }
      }
    }

    // 1D. Staff (Always generate new UUID, dedup by normalized employee_code OR full name within facility_id)
    for (const entry of tables.filter((t) => t.target === 'staff')) {
      const fallbackDept = await ensureFallbackDeptId();
      for (const row of entry.rows) {
        const cleanName = pickStr(row, ['name', 'Name', 'full_name', 'employee_name']);
        if (!cleanName) continue;
        const legacyId = pickStr(row, ['id', 'ID', 'legacy_id']);
        const rawCode = pickStr(row, ['employee_code', 'code', 'Code', 'emp_code', 'ID', 'id']);
        const normName = cleanName.toLowerCase();
        const normCode = rawCode
          ? rawCode.toUpperCase()
          : `MIG-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

        const rawDeptId = pickStr(row, ['department_id', 'dept_id']);
        const rawDeptName = pickStr(row, ['department_name', 'department', 'Department', 'Job', 'job']);
        let resolvedDeptId =
          (rawDeptId && deptByLegacyId.get(rawDeptId)) ||
          (rawDeptName && deptByName.get(rawDeptName.toLowerCase())) ||
          '';

        if (!resolvedDeptId && rawDeptName) {
          const autoDeptUuid = `dep-${crypto.randomUUID()}`;
          await tx.run('INSERT INTO facility_departments (id, facility_id, name, type) VALUES (?, ?, ?, ?)', [
            autoDeptUuid,
            facilityId,
            rawDeptName,
            'إكلينيكي',
          ]);
          deptByName.set(rawDeptName.toLowerCase(), autoDeptUuid);
          resolvedDeptId = autoDeptUuid;
          summary.departments_upserted++;
        }
        if (!resolvedDeptId) resolvedDeptId = fallbackDept;

        const existingId = staffByName.get(normName) || staffByCode.get(normCode);
        const category = pickStr(row, ['category', 'Category'], 'تمريض');

        if (existingId) {
          summary.duplicates_skipped++;
          if (legacyId) staffByLegacyId.set(legacyId, existingId);
        } else {
          const uniqueCode = staffByCode.has(normCode)
            ? `${normCode}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`
            : normCode;
          const newUuid = `stf-${crypto.randomUUID()}`;
          await tx.run(
            'INSERT INTO facility_staff (id, facility_id, name, employee_code, category, department_id) VALUES (?, ?, ?, ?, ?, ?)',
            [newUuid, facilityId, cleanName, uniqueCode, category, resolvedDeptId]
          );
          staffByName.set(normName, newUuid);
          staffByCode.set(uniqueCode, newUuid);
          if (legacyId) staffByLegacyId.set(legacyId, newUuid);
          summary.staff_upserted++;
        }
      }
    }

    // ------------------------------------------------------------------------
    // PHASE 2: MODULE RECORDS (NEW UUID + legacy_id PRESERVED + DEDUP)
    // ------------------------------------------------------------------------
    const fallbackDept = await ensureFallbackDeptId();
    const firstStaffId = Array.from(staffByName.values())[0] || 'unassigned';

    // Helper: check legacy_id already migrated for this facility
    const isDuplicateLegacy = async (table: string, legacyId: string | null): Promise<boolean> => {
      if (!legacyId) return false;
      const hit = await tx.get(
        `SELECT id FROM ${table} WHERE facility_id = ? AND legacy_id = ? LIMIT 1`,
        [facilityId, legacyId]
      );
      return Boolean(hit);
    };

    const resolveDept = async (rawId: string, rawName: string): Promise<string> => {
      if (rawId && deptByLegacyId.get(rawId)) return deptByLegacyId.get(rawId)!;
      if (rawName && deptByName.get(rawName.toLowerCase())) return deptByName.get(rawName.toLowerCase())!;
      if (rawName) {
        const newUuid = `dep-${crypto.randomUUID()}`;
        await tx.run('INSERT INTO facility_departments (id, facility_id, name, type) VALUES (?, ?, ?, ?)', [
          newUuid,
          facilityId,
          rawName,
          'إكلينيكي',
        ]);
        deptByName.set(rawName.toLowerCase(), newUuid);
        summary.departments_upserted++;
        return newUuid;
      }
      return fallbackDept;
    };

    const m1InsertSql = `INSERT INTO module_one_records
         (id, facility_id, staff_id, department_id, legacy_id, created_by, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    // 2A. Module One Records (supports both portal module_one_records and flat legacy `reports` rows)
    for (const entry of tables.filter((t) => t.target === 'module_one')) {
      const flatGroups = new Map<
        string,
        {
          legacyIds: string[];
          date: string;
          period: string;
          department: string;
          inspector: string;
          supervisor: string;
          evaluations: Array<{ procedure: string; status: string; note: string; rec: string }>;
        }
      >();

      for (const row of entry.rows) {
        const legacyId = pickStr(row, ['legacy_id', 'id', 'ID']);
        if (row.payload !== undefined) {
          if (await isDuplicateLegacy('module_one_records', legacyId || null)) {
            summary.duplicates_skipped++;
            continue;
          }
          const payloadObj =
            typeof row.payload === 'string'
              ? (JSON.parse(row.payload) as Record<string, unknown>)
              : (row.payload as Record<string, unknown>);
          const staffId =
            staffByLegacyId.get(String(row.staff_id || '')) ||
            staffByName.get(String(payloadObj?.inspector || '').trim().toLowerCase()) ||
            firstStaffId;
          const deptId = await resolveDept(
            String(row.department_id || ''),
            String(payloadObj?.department || '')
          );
          await tx.run(m1InsertSql, [
            `m1-${crypto.randomUUID()}`,
            facilityId,
            staffId,
            deptId,
            legacyId || null,
            createdBy,
            JSON.stringify(payloadObj),
            String(row.status || 'completed'),
            String(row.created_at || new Date().toISOString()),
          ]);
          summary.module_one_upserted++;
        } else {
          const date = pickStr(row, ['date', 'Date', 'report_date'], new Date().toISOString().slice(0, 10));
          const period = pickStr(row, ['period', 'Period'], 'صباحي');
          const department = pickStr(row, ['department', 'Department', 'dept'], 'عام');
          const inspector = pickStr(row, ['inspector', 'Inspector'], '-');
          const supervisor = pickStr(row, ['supervisor', 'Supervisor'], '-');
          const procedure = pickStr(row, ['procedure', 'Procedure', 'note', 'Note'], 'إجراء تقييم');
          const statusVal = pickStr(row, ['status', 'Status'], 'Yes') === 'No' ? 'No' : 'Yes';
          const note = pickStr(row, ['note', 'Note']);
          const rec = pickStr(row, ['rec', 'Rec', 'recommendation']);
          const gKey = `${date}||${period}||${department}||${inspector}`;
          const grp = flatGroups.get(gKey) || {
            legacyIds: [],
            date,
            period,
            department,
            inspector,
            supervisor,
            evaluations: [],
          };
          if (legacyId) grp.legacyIds.push(legacyId);
          grp.evaluations.push({ procedure, status: statusVal, note, rec });
          flatGroups.set(gKey, grp);
        }
      }

      for (const [gKey, grp] of flatGroups.entries()) {
        const grpLegacyId = grp.legacyIds[0] || `rpt-${gKey}`;
        if (await isDuplicateLegacy('module_one_records', grpLegacyId)) {
          summary.duplicates_skipped++;
          continue;
        }
        const deptId = await resolveDept('', grp.department);
        const staffId = staffByName.get(grp.inspector.toLowerCase()) || firstStaffId;
        const hasNo = grp.evaluations.some((e) => e.status === 'No');
        await tx.run(m1InsertSql, [
          `m1-${crypto.randomUUID()}`,
          facilityId,
          staffId,
          deptId,
          grpLegacyId,
          createdBy,
          JSON.stringify({
            report_type: 'weekly_round',
            date: grp.date,
            period: grp.period,
            department: grp.department,
            inspector: grp.inspector,
            supervisor: grp.supervisor,
            evaluations: grp.evaluations,
          }),
          hasNo ? 'pending' : 'completed',
          `${grp.date.split('T')[0]}T10:00:00.000Z`,
        ]);
        summary.module_one_upserted++;
      }
    }

    // 2B. Module Two Records (supports portal module_two_records + Training `logs` + Training `plan`)
    const m2InsertSql = `INSERT INTO module_two_records
         (id, facility_id, department_id, legacy_id, created_by, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    for (const entry of tables.filter((t) => t.target === 'module_two')) {
      for (const row of entry.rows) {
        const legacyId = pickStr(row, ['legacy_id', 'id', 'ID']);
        if (row.payload !== undefined) {
          if (await isDuplicateLegacy('module_two_records', legacyId || null)) {
            summary.duplicates_skipped++;
            continue;
          }
          const payloadObj =
            typeof row.payload === 'string'
              ? (JSON.parse(row.payload) as Record<string, unknown>)
              : (row.payload as Record<string, unknown>);
          const deptId = await resolveDept(String(row.department_id || ''), '');
          await tx.run(m2InsertSql, [
            `m2-${crypto.randomUUID()}`,
            facilityId,
            deptId,
            legacyId || null,
            createdBy,
            JSON.stringify(payloadObj),
            String(row.status || 'training_log'),
            String(row.created_at || new Date().toISOString()),
          ]);
          summary.module_two_upserted++;
        } else {
          const traineeName = pickStr(row, ['TraineeName', 'traineeName', 'trainee_name']);
          const monthVal = pickStr(row, ['Month', 'month']);
          const policiesVal = pickStr(row, ['Policies', 'policies']);
          const categoryVal = pickStr(row, ['Category', 'category'], 'تمريض');
          if (traineeName) {
            const dateStr = pickStr(row, ['Date', 'date'], new Date().toISOString().slice(0, 10)).split('T')[0];
            const trainerVal = pickStr(row, ['Trainer', 'trainer'], '-');
            const effectiveLegacy = legacyId || `trn-${dateStr}-${traineeName}-${categoryVal}`;
            if (await isDuplicateLegacy('module_two_records', effectiveLegacy)) {
              summary.duplicates_skipped++;
              continue;
            }
            await tx.run(m2InsertSql, [
              `m2-${crypto.randomUUID()}`,
              facilityId,
              fallbackDept,
              effectiveLegacy,
              createdBy,
              JSON.stringify({
                record_type: 'training_log',
                ID: effectiveLegacy,
                Date: dateStr,
                Month: monthVal || Number(dateStr.split('-')[1] || 1),
                Year: pickStr(row, ['Year', 'year'], dateStr.split('-')[0] || String(new Date().getFullYear())),
                Category: categoryVal,
                Policies: policiesVal,
                TraineeName: traineeName,
                Trainer: trainerVal,
              }),
              'training_log',
              `${dateStr}T09:00:00.000Z`,
            ]);
            summary.module_two_upserted++;
          } else if (monthVal && policiesVal) {
            const yearVal = pickStr(row, ['Year', 'year'], String(new Date().getFullYear()));
            const effectiveLegacy = legacyId || `pln-${yearVal}-${monthVal}-${categoryVal}`;
            if (await isDuplicateLegacy('module_two_records', effectiveLegacy)) {
              summary.duplicates_skipped++;
              continue;
            }
            await tx.run(m2InsertSql, [
              `m2-${crypto.randomUUID()}`,
              facilityId,
              fallbackDept,
              effectiveLegacy,
              createdBy,
              JSON.stringify({
                record_type: 'training_plan',
                ID: effectiveLegacy,
                Month: monthVal,
                Year: yearVal,
                Category: categoryVal,
                Policies: policiesVal,
              }),
              'training_plan',
              new Date().toISOString(),
            ]);
            summary.module_two_upserted++;
          }
        }
      }
    }

    // 2C. Module Three Records (supports portal module_three_records + flat WHO Hand Hygiene `Observations` rows)
    const m3InsertSql = `INSERT INTO module_three_records
         (id, facility_id, department_id, legacy_id, created_by, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    for (const entry of tables.filter((t) => t.target === 'module_three')) {
      const hhGroups = new Map<
        string,
        { sessionInfo: HhSessionInfo; profMap: Map<string, HhProfessional> }
      >();

      for (const row of entry.rows) {
        const legacyId = pickStr(row, ['legacy_id', 'id', 'ID', 'Session ID', 'sessionId', 'session_id']);
        if (row.payload !== undefined) {
          if (await isDuplicateLegacy('module_three_records', legacyId || null)) {
            summary.duplicates_skipped++;
            continue;
          }
          const payloadObj =
            typeof row.payload === 'string'
              ? (JSON.parse(row.payload) as Record<string, unknown>)
              : (row.payload as Record<string, unknown>);
          const sInfo = payloadObj?.sessionInfo as { department?: string } | undefined;
          const deptId = await resolveDept(String(row.department_id || ''), String(sInfo?.department || ''));
          await tx.run(m3InsertSql, [
            `m3-${crypto.randomUUID()}`,
            facilityId,
            deptId,
            legacyId || null,
            createdBy,
            JSON.stringify(payloadObj),
            String(row.status || 'hand_hygiene'),
            String(row.created_at || new Date().toISOString()),
          ]);
          summary.module_three_upserted++;
        } else if (row.sessionInfo !== undefined) {
          const sInfo = row.sessionInfo as HhSessionInfo;
          const sid = String(sInfo.sessionId || legacyId || `hh-${crypto.randomUUID().slice(0, 8)}`);
          if (await isDuplicateLegacy('module_three_records', sid)) {
            summary.duplicates_skipped++;
            continue;
          }
          const deptId = await resolveDept('', String(sInfo.department || ''));
          const sDate = String(sInfo.date || new Date().toISOString().slice(0, 10));
          await tx.run(m3InsertSql, [
            `m3-${crypto.randomUUID()}`,
            facilityId,
            deptId,
            sid,
            createdBy,
            JSON.stringify({
              record_type: 'hand_hygiene',
              sessionInfo: { ...sInfo, sessionId: sid },
              professionals: Array.isArray(row.professionals) ? row.professionals : [],
            }),
            'hand_hygiene',
            `${sDate}T10:00:00.000Z`,
          ]);
          summary.module_three_upserted++;
        } else {
          const sid = pickStr(row, ['Session ID', 'sessionId', 'session_id'], '');
          if (!sid) continue;
          if (!hhGroups.has(sid)) {
            hhGroups.set(sid, {
              sessionInfo: {
                sessionId: sid,
                facility: pickStr(row, ['Facility', 'facility']),
                service: pickStr(row, ['Service', 'service']),
                ward: pickStr(row, ['Ward', 'ward']),
                department: pickStr(row, ['Department', 'department'], 'عام'),
                country: pickStr(row, ['Country', 'country'], 'Egypt'),
                city: pickStr(row, ['City', 'city']),
                periodNumber: pickStr(row, ['Period Number', 'periodNumber']),
                date: pickStr(row, ['Session Date', 'date'], new Date().toISOString().slice(0, 10)),
                startTime: pickStr(row, ['Start Time', 'startTime']),
                endTime: pickStr(row, ['End Time', 'endTime']),
                duration: pickStr(row, ['Duration (min)', 'duration']),
                sessionNumber: pickStr(row, ['Session No', 'sessionNumber']),
                pageNumber: pickStr(row, ['Page No', 'pageNumber']),
                observer: pickStr(row, ['Observer', 'observer']),
              },
              profMap: new Map(),
            });
          }
          const grp = hhGroups.get(sid)!;
          const pCode = pickStr(row, ['Prof. Code', 'categoryCode'], '1');
          const colNoRaw = pickStr(row, ['Column No', 'colNo']);
          const profKey = colNoRaw ? `col_${colNoRaw}` : `code_${pCode}`;
          if (!grp.profMap.has(profKey)) {
            grp.profMap.set(profKey, {
              categoryCode: pCode,
              categoryName: pickStr(row, ['Professional Cat.', 'categoryName'], 'أطباء'),
              _colNo: colNoRaw ? parseInt(colNoRaw, 10) : 1,
              opportunities: [],
            });
          }
          const indications: string[] = [];
          if (row['Ind: Bef. Pat'] === 'Yes') indications.push('bef-pat');
          if (row['Ind: Bef. Asept'] === 'Yes') indications.push('bef-asept');
          if (row['Ind: Aft. Body Fluid'] === 'Yes') indications.push('aft-bf');
          if (row['Ind: Aft. Pat'] === 'Yes') indications.push('aft-pat');
          if (row['Ind: Aft. Surround'] === 'Yes') indications.push('aft-p-surr');

          grp.profMap.get(profKey)!.opportunities.push({
            number:
              (row['Opportunity No'] as number | string | undefined) ||
              grp.profMap.get(profKey)!.opportunities.length + 1,
            indications,
            action: pickStr(row, ['Action (HR/HW/Missed)', 'action'], 'Missed'),
            gloves: row['Gloves Used'] === 'Yes',
          });
        }
      }

      for (const [sid, grp] of hhGroups.entries()) {
        if (await isDuplicateLegacy('module_three_records', sid)) {
          summary.duplicates_skipped++;
          continue;
        }
        const deptId = await resolveDept('', String(grp.sessionInfo.department || ''));
        const profs = Array.from(grp.profMap.values()).sort((a, b) => (a._colNo || 999) - (b._colNo || 999));
        const sDate = String(grp.sessionInfo.date || new Date().toISOString().slice(0, 10));
        await tx.run(m3InsertSql, [
          `m3-${crypto.randomUUID()}`,
          facilityId,
          deptId,
          sid,
          createdBy,
          JSON.stringify({
            record_type: 'hand_hygiene',
            sessionInfo: grp.sessionInfo,
            professionals: profs,
          }),
          'hand_hygiene',
          `${sDate}T10:00:00.000Z`,
        ]);
        summary.module_three_upserted++;
      }
    }
  });

  return summary;
}

app.post(
  '/api/admin/migrate/smart',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const { facility_id, tables } = req.body as {
      facility_id?: string;
      tables?: SmartMigrationTableEntry[];
    };

    if (!facility_id || !Array.isArray(tables)) {
      res.status(400).json({ error: 'يرجى تحديد المركز المستهدف وجداول الترحيل.' });
      return;
    }
    const facility = await db.get('SELECT id FROM facilities WHERE id = ?', [facility_id]);
    if (!facility) {
      res.status(404).json({ error: 'المركز المستهدف غير موجود.' });
      return;
    }

    const summary = await executeSmartMigration(facility_id, tables, req.auth!.id);
    res.json(summary);
  })
);

app.post(
  '/api/admin/migrate/full',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const { facility_id, data } = req.body as {
      facility_id?: string;
      data?: Record<string, unknown>;
    };

    if (!facility_id || !data) {
      res.status(400).json({ error: 'يرجى اختيار المركز وتوفير بيانات الترحيل.' });
      return;
    }
    const facility = await db.get('SELECT id FROM facilities WHERE id = ?', [facility_id]);
    if (!facility) {
      res.status(404).json({ error: 'المركز المستهدف غير موجود.' });
      return;
    }

    const tables: SmartMigrationTableEntry[] = [];
    if (data.leaders && typeof data.leaders === 'object') {
      tables.push({ sourceTable: 'leaders', target: 'leaders', rows: [data.leaders as Record<string, unknown>] });
    }
    if (data.module_one_settings && typeof data.module_one_settings === 'object') {
      const arr = Array.isArray(data.module_one_settings) ? data.module_one_settings : [data.module_one_settings];
      tables.push({ sourceTable: 'module_one_settings', target: 'module_one_settings', rows: arr as Array<Record<string, unknown>> });
    }
    if (data.module_two_settings && typeof data.module_two_settings === 'object') {
      const arr = Array.isArray(data.module_two_settings) ? data.module_two_settings : [data.module_two_settings];
      tables.push({ sourceTable: 'module_two_settings', target: 'module_two_settings', rows: arr as Array<Record<string, unknown>> });
    }
    if (data.module_three_settings && typeof data.module_three_settings === 'object') {
      const arr = Array.isArray(data.module_three_settings) ? data.module_three_settings : [data.module_three_settings];
      tables.push({ sourceTable: 'module_three_settings', target: 'module_three_settings', rows: arr as Array<Record<string, unknown>> });
    }
    if (Array.isArray(data.departments)) {
      tables.push({ sourceTable: 'departments', target: 'departments', rows: data.departments as Array<Record<string, unknown>> });
    }
    if (Array.isArray(data.staff)) {
      tables.push({ sourceTable: 'staff', target: 'staff', rows: data.staff as Array<Record<string, unknown>> });
    }
    if (Array.isArray(data.module_one_records)) {
      tables.push({ sourceTable: 'module_one_records', target: 'module_one', rows: data.module_one_records as Array<Record<string, unknown>> });
    }
    if (Array.isArray(data.module_two_records)) {
      tables.push({ sourceTable: 'module_two_records', target: 'module_two', rows: data.module_two_records as Array<Record<string, unknown>> });
    }
    if (Array.isArray(data.module_three_records)) {
      tables.push({ sourceTable: 'module_three_records', target: 'module_three', rows: data.module_three_records as Array<Record<string, unknown>> });
    }

    const summary = await executeSmartMigration(facility_id, tables, req.auth!.id);
    res.json(summary);
  })
);

app.post(
  '/api/admin/migrate/module',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const { facility_id, module_key, records } = req.body as {
      facility_id?: string;
      module_key?: string;
      records?: Array<Record<string, unknown>>;
    };

    if (!facility_id || !module_key || !MODULE_TABLE_MAP[module_key] || !Array.isArray(records)) {
      res.status(400).json({ error: 'يرجى تحديد المركز والموديول ومصفوفة السجلات.' });
      return;
    }
    const facility = await db.get('SELECT id FROM facilities WHERE id = ?', [facility_id]);
    if (!facility) {
      res.status(404).json({ error: 'المركز المستهدف غير موجود.' });
      return;
    }

    const target = module_key as 'module_one' | 'module_two' | 'module_three';
    const summary = await executeSmartMigration(
      facility_id,
      [{ sourceTable: module_key, target, rows: records }],
      req.auth!.id
    );
    res.json(summary);
  })
);

// ============================================================================
// 14. MODULE ONE: INSPECTION REPORTS (UNIFIED DB QUERIES & SAVE)
// ============================================================================
interface WeeklyEvalPayloadItem {
  procedure?: string;
  status?: string;
  note?: string;
  rec?: string;
}

interface WeeklyRoundPayload {
  report_type?: string;
  date?: string;
  period?: string;
  department?: string;
  inspector?: string;
  supervisor?: string;
  evaluations?: WeeklyEvalPayloadItem[];
}

function flattenWeeklyRecordToRows(row: {
  id: string;
  created_at: string;
  payload: string;
}): Array<[string, string, string, string, string, string, string, string, string, string, string]> {
  try {
    const parsed = JSON.parse(row.payload) as WeeklyRoundPayload;
    if (!parsed || !Array.isArray(parsed.evaluations) || !parsed.date) return [];
    const dateStr = String(parsed.date);
    const period = String(parsed.period || '-');
    const dept = String(parsed.department || '-');
    const inspector = String(parsed.inspector || '-');
    const supervisor = String(parsed.supervisor || '-');

    return parsed.evaluations.map((ev, idx) => [
      dateStr,
      row.created_at,
      `${row.id}#${idx}`,
      period,
      dept,
      inspector,
      supervisor,
      String(ev.procedure || ev.note || 'إجراء تقييم'),
      ev.status === 'No' ? 'No' : 'Yes',
      String(ev.note || ''),
      String(ev.rec || ''),
    ]);
  } catch {
    return [];
  }
}

async function queryFacilityReportRows(
  facilityId: string,
  type: 'monthly' | 'yearly' | 'range',
  params: string | { start?: string; end?: string }
) {
  const rows = await db.all<{ id: string; payload: string; created_at: string }>(
    'SELECT id, payload, created_at FROM module_one_records WHERE facility_id = ? ORDER BY created_at ASC',
    [facilityId]
  );

  const result: Array<[string, string, string, string, string, string, string, string, string, string, string]> = [];
  for (const row of rows) {
    const flattened = flattenWeeklyRecordToRows(row);
    for (const item of flattened) {
      const dateStr = item[0];
      if ((type === 'monthly' || type === 'yearly') && typeof params === 'string') {
        if (dateStr.startsWith(params)) result.push(item);
      } else if (type === 'range' && typeof params === 'object' && params !== null) {
        const start = params.start || '';
        const end = params.end || '';
        if ((!start || dateStr >= start) && (!end || dateStr <= end)) {
          result.push(item);
        }
      }
    }
  }
  result.sort((a, b) => a[0].localeCompare(b[0]));
  return result;
}

app.post(
  '/api/facilities/:facilityId/reports/weekly',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { date, period, department, inspector, supervisor, evaluations } = req.body as WeeklyRoundPayload;
    if (!date || !period || !department || !inspector || !Array.isArray(evaluations) || evaluations.length === 0) {
      res.status(400).json({ error: 'يرجى استكمال التاريخ والفترة والقسم والقائم بالمرور وبنود التقييم.' });
      return;
    }

    const deptRow = await db.get<{ id: string }>(
      'SELECT id FROM facility_departments WHERE facility_id = ? AND name = ? LIMIT 1',
      [facilityId, department]
    );
    const fallbackDept = await db.get<{ id: string }>(
      'SELECT id FROM facility_departments WHERE facility_id = ? LIMIT 1',
      [facilityId]
    );

    const staffRow = await db.get<{ id: string }>(
      'SELECT id FROM facility_staff WHERE facility_id = ? AND name = ? LIMIT 1',
      [facilityId, inspector]
    );
    const fallbackStaff = await db.get<{ id: string }>(
      'SELECT id FROM facility_staff WHERE facility_id = ? LIMIT 1',
      [facilityId]
    );

    const hasViolation = evaluations.some((ev) => ev.status === 'No');
    const status = hasViolation ? 'pending' : 'completed';
    const id = `m1-round-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();

    const payload = {
      report_type: 'weekly_round',
      date,
      period,
      department,
      inspector,
      supervisor: supervisor || '-',
      evaluations,
    };

    await db.run(
      `INSERT INTO module_one_records (id, facility_id, staff_id, department_id, legacy_id, created_by, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        facilityId,
        staffRow?.id || fallbackStaff?.id || 'unassigned',
        deptRow?.id || fallbackDept?.id || 'unassigned',
        null,
        req.auth!.id,
        JSON.stringify(payload),
        status,
        createdAt,
      ]
    );

    res.status(201).json({ id, status, created_at: createdAt });
  })
);

app.put(
  '/api/facilities/:facilityId/reports/weekly/:recordId',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const existing = await db.get<{ id: string; created_at: string }>(
      'SELECT id, created_at FROM module_one_records WHERE id = ? AND facility_id = ?',
      [req.params.recordId, facilityId]
    );
    if (!existing) {
      res.status(404).json({ error: 'تقرير المرور غير موجود في هذا المركز.' });
      return;
    }

    const { date, period, department, inspector, supervisor, evaluations } = req.body as WeeklyRoundPayload;
    if (!date || !period || !department || !inspector || !Array.isArray(evaluations) || evaluations.length === 0) {
      res.status(400).json({ error: 'يرجى استكمال التاريخ والفترة والقسم والقائم بالمرور وبنود التقييم.' });
      return;
    }

    const deptRow = await db.get<{ id: string }>(
      'SELECT id FROM facility_departments WHERE facility_id = ? AND name = ? LIMIT 1',
      [facilityId, department]
    );
    const fallbackDept = await db.get<{ id: string }>(
      'SELECT id FROM facility_departments WHERE facility_id = ? LIMIT 1',
      [facilityId]
    );

    const staffRow = await db.get<{ id: string }>(
      'SELECT id FROM facility_staff WHERE facility_id = ? AND name = ? LIMIT 1',
      [facilityId, inspector]
    );
    const fallbackStaff = await db.get<{ id: string }>(
      'SELECT id FROM facility_staff WHERE facility_id = ? LIMIT 1',
      [facilityId]
    );

    const hasViolation = evaluations.some((ev) => ev.status === 'No');
    const status = hasViolation ? 'pending' : 'completed';

    const payload = {
      report_type: 'weekly_round',
      date,
      period,
      department,
      inspector,
      supervisor: supervisor || '-',
      evaluations,
    };

    await db.run(
      `UPDATE module_one_records
       SET staff_id = ?, department_id = ?, payload = ?, status = ?
       WHERE id = ? AND facility_id = ?`,
      [
        staffRow?.id || fallbackStaff?.id || 'unassigned',
        deptRow?.id || fallbackDept?.id || 'unassigned',
        JSON.stringify(payload),
        status,
        req.params.recordId,
        facilityId,
      ]
    );

    res.json({ id: existing.id, status, created_at: existing.created_at });
  })
);

app.delete(
  '/api/facilities/:facilityId/reports/weekly/:recordId',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const result = await db.run('DELETE FROM module_one_records WHERE id = ? AND facility_id = ?', [
      req.params.recordId,
      facilityId,
    ]);

    if (result.changes === 0) {
      res.status(404).json({ error: 'تقرير المرور غير موجود.' });
      return;
    }

    res.json({ deleted: true });
  })
);

app.post(
  '/api/facilities/:facilityId/reports/query',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { type, params } = req.body as {
      type?: 'monthly' | 'yearly' | 'range';
      params?: string | { start?: string; end?: string };
    };

    if (!type || params === undefined) {
      res.status(400).json({ error: 'معاملات البحث عن التقرير غير مكتملة.' });
      return;
    }

    res.json(await queryFacilityReportRows(facilityId, type, params));
  })
);

app.post(
  '/api/facilities/:facilityId/reports/copy-month',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { sourceMonth, targetMonth, replaceExisting } = req.body as {
      sourceMonth?: string;
      targetMonth?: string;
      replaceExisting?: boolean;
    };

    if (!sourceMonth || !targetMonth || sourceMonth === targetMonth) {
      res.status(400).json({ error: 'يرجى تحديد شهر مصدر وشهر هدف مختلفين.' });
      return;
    }

    const [targetYear, targetMon] = targetMonth.split('-').map(Number);
    if (!targetYear || !targetMon) {
      res.status(400).json({ error: 'تنسيق الشهر الهدف غير صالح.' });
      return;
    }
    const daysInTargetMonth = new Date(targetYear, targetMon, 0).getDate();

    const existingRecords = await db.all<{
      id: string;
      staff_id: string;
      department_id: string;
      payload: string;
      status: string;
    }>('SELECT id, staff_id, department_id, payload, status FROM module_one_records WHERE facility_id = ?', [
      facilityId,
    ]);

    const sourceRecords: Array<{
      staff_id: string;
      department_id: string;
      parsed: WeeklyRoundPayload;
      status: string;
    }> = [];
    const targetIdsToDelete: string[] = [];

    for (const rec of existingRecords) {
      try {
        const parsed = JSON.parse(rec.payload) as WeeklyRoundPayload;
        if (parsed?.date && Array.isArray(parsed.evaluations)) {
          if (parsed.date.startsWith(sourceMonth)) {
            sourceRecords.push({
              staff_id: rec.staff_id,
              department_id: rec.department_id,
              parsed,
              status: rec.status,
            });
          }
          if (replaceExisting && parsed.date.startsWith(targetMonth)) {
            targetIdsToDelete.push(rec.id);
          }
        }
      } catch {
        // ignore non-round
      }
    }

    if (sourceRecords.length === 0) {
      res.status(404).json({ error: `لا توجد تقارير مرور مسجلة في شهر (${sourceMonth}) لنسخها.` });
      return;
    }

    let copiedCount = 0;
    await db.transaction(async (tx) => {
      for (const delId of targetIdsToDelete) {
        await tx.run('DELETE FROM module_one_records WHERE id = ? AND facility_id = ?', [delId, facilityId]);
      }
      const insertSql = `INSERT INTO module_one_records (id, facility_id, staff_id, department_id, legacy_id, created_by, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      for (const src of sourceRecords) {
        const dayPart = Number(src.parsed.date?.split('-')[2] || '1') || 1;
        const safeDay = String(Math.min(dayPart, daysInTargetMonth)).padStart(2, '0');
        const newDate = `${targetMonth}-${safeDay}`;
        const newPayload: WeeklyRoundPayload = {
          ...src.parsed,
          report_type: 'weekly_round',
          date: newDate,
        };
        await tx.run(insertSql, [
          `m1-round-${crypto.randomUUID()}`,
          facilityId,
          src.staff_id,
          src.department_id,
          null,
          req.auth!.id,
          JSON.stringify(newPayload),
          src.status,
          new Date().toISOString(),
        ]);
        copiedCount += src.parsed.evaluations?.length || 0;
      }
    });

    const targetRows = await queryFacilityReportRows(facilityId, 'monthly', targetMonth);
    res.json({
      copiedCount,
      rows: targetRows,
      message: `تم نسخ ${copiedCount} تقييم من (${sourceMonth}) إلى (${targetMonth}).`,
    });
  })
);

// ============================================================================
// 15. MODULE TWO: TRAINING PROGRAM (BACKED BY module_two_records + unified settings)
// ============================================================================
app.get(
  '/api/facilities/:facilityId/training/data',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    res.json(await buildTrainingBundleFromUnifiedDb(facilityId));
  })
);

app.put(
  '/api/facilities/:facilityId/training/data',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const body = req.body as Partial<TrainingStateBundle> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'بيانات البرنامج التدريبي غير صالحة.' });
      return;
    }

    const saved = await saveTrainingBundleToUnifiedDb(
      facilityId,
      {
        employees: body.employees || [],
        logs: body.logs || [],
        settings: body.settings || [],
        plan: body.plan || [],
        categories: body.categories || [],
      },
      req.auth!.id
    );
    res.json(saved);
  })
);

// ============================================================================
// 16. MODULE THREE: HAND HYGIENE COMPLIANCE (BACKED BY module_three_records)
// ============================================================================
app.get(
  '/api/facilities/:facilityId/hand-hygiene/sessions',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;
    res.json(await getFacilityHhSessions(facilityId));
  })
);

app.post(
  '/api/facilities/:facilityId/hand-hygiene/sessions',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const body = req.body as Partial<HhSessionInfo> & { professionals?: HhProfessional[] };
    if (!body || !Array.isArray(body.professionals)) {
      res.status(400).json({ error: 'بيانات جلسة الرصد غير مكتملة.' });
      return;
    }

    const { professionals, ...info } = body;
    const sessionId = await upsertHhSessionUnified(
      facilityId,
      {
        sessionInfo: {
          ...info,
          sessionId: info.sessionId || `hh-${crypto.randomUUID().slice(0, 8)}`,
        },
        professionals,
      },
      req.auth!.id
    );

    const resequenced = await getFacilityHhSessions(facilityId);
    const saved = resequenced.find((s) => s.sessionInfo.sessionId === sessionId);
    res.status(201).json({
      success: true,
      sessionId,
      sessionNumber: String(saved?.sessionInfo.sessionNumber || info.sessionNumber || '1'),
    });
  })
);

app.delete(
  '/api/facilities/:facilityId/hand-hygiene/sessions/:sessionId',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const sid = req.params.sessionId;
    const result = await db.run(
      "DELETE FROM module_three_records WHERE facility_id = ? AND status = 'hand_hygiene' AND (legacy_id = ? OR id = ? OR json_extract(payload, '$.sessionInfo.sessionId') = ?)",
      [facilityId, sid, sid, sid]
    );

    if (result.changes === 0) {
      res.status(404).json({ error: 'جلسة الرصد غير موجودة في هذا المركز.' });
      return;
    }
    res.json({ success: true });
  })
);

app.post(
  '/api/facilities/:facilityId/hand-hygiene/delete-months',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { monthKeys } = req.body as { monthKeys?: string[] };
    if (!Array.isArray(monthKeys) || monthKeys.length === 0) {
      res.status(400).json({ error: 'يرجى تحديد الأشهر المطلوب حذفها.' });
      return;
    }

    await db.transaction(async (tx) => {
      const delSql =
        "DELETE FROM module_three_records WHERE facility_id = ? AND status = 'hand_hygiene' AND substr(json_extract(payload, '$.sessionInfo.date'), 1, 7) = ?";
      for (const mk of monthKeys) {
        await tx.run(delSql, [facilityId, String(mk || '').trim()]);
      }
    });
    res.json({ success: true });
  })
);

app.patch(
  '/api/facilities/:facilityId/hand-hygiene/sessions/:sessionId/date',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { newDate } = req.body as { newDate?: string };
    if (!newDate?.trim()) {
      res.status(400).json({ error: 'يرجى إدخال التاريخ الجديد.' });
      return;
    }

    const sid = req.params.sessionId;
    const row = await db.get<{ id: string; payload: string }>(
      "SELECT id, payload FROM module_three_records WHERE facility_id = ? AND status = 'hand_hygiene' AND (legacy_id = ? OR id = ? OR json_extract(payload, '$.sessionInfo.sessionId') = ?) LIMIT 1",
      [facilityId, sid, sid, sid]
    );

    if (!row) {
      res.status(404).json({ error: 'الجلسة غير موجودة.' });
      return;
    }

    const parsed = JSON.parse(row.payload) as HhSessionRecord & { record_type?: string };
    const d = new Date(newDate);
    const periodNumber = !isNaN(d.getTime()) ? String(d.getMonth() + 1) : parsed.sessionInfo.periodNumber;
    parsed.sessionInfo = {
      ...parsed.sessionInfo,
      date: newDate.trim(),
      periodNumber,
    };

    await db.run(
      'UPDATE module_three_records SET payload = ?, created_at = ? WHERE id = ? AND facility_id = ?',
      [JSON.stringify(parsed), `${newDate.trim()}T10:00:00.000Z`, row.id, facilityId]
    );

    const resequenced = await getFacilityHhSessions(facilityId);
    const updated = resequenced.find((s) => s.sessionInfo.sessionId === sid);

    res.json({
      success: true,
      newSessionNo: String(updated?.sessionInfo.sessionNumber || '1'),
    });
  })
);

app.patch(
  '/api/facilities/:facilityId/hand-hygiene/sessions/:sessionId/department',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;

    const { department } = req.body as { department?: string };
    if (typeof department !== 'string') {
      res.status(400).json({ error: 'اسم القسم غير صالح.' });
      return;
    }

    const sid = req.params.sessionId;
    const row = await db.get<{ id: string; payload: string }>(
      "SELECT id, payload FROM module_three_records WHERE facility_id = ? AND status = 'hand_hygiene' AND (legacy_id = ? OR id = ? OR json_extract(payload, '$.sessionInfo.sessionId') = ?) LIMIT 1",
      [facilityId, sid, sid, sid]
    );

    if (!row) {
      res.status(404).json({ error: 'الجلسة غير موجودة.' });
      return;
    }

    const parsed = JSON.parse(row.payload) as HhSessionRecord & { record_type?: string };
    parsed.sessionInfo = {
      ...parsed.sessionInfo,
      department: department.trim(),
    };

    const deptRow = await db.get<{ id: string }>(
      'SELECT id FROM facility_departments WHERE facility_id = ? AND trim(name) = ? LIMIT 1',
      [facilityId, department.trim()]
    );

    await db.run(
      'UPDATE module_three_records SET department_id = COALESCE(?, department_id), payload = ? WHERE id = ? AND facility_id = ?',
      [deptRow?.id || null, JSON.stringify(parsed), row.id, facilityId]
    );

    res.json({ success: true });
  })
);

// ============================================================================
// 16B. ISOLATED PER-MODULE SETTINGS ROUTES (STRICT WHERE facility_id = ?)
// ============================================================================
app.get(
  '/api/facilities/:facilityId/modules/module_one/settings',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;
    res.json(await getOrCreateModuleOneSettings(facilityId));
  })
);

app.put(
  '/api/facilities/:facilityId/modules/module_one/settings',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;
    const body = req.body as Partial<ModuleOneSettingsPayload> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'بيانات إعدادات تقارير المرور غير صالحة.' });
      return;
    }
    res.json(await saveModuleOneSettings(facilityId, body));
  })
);

app.get(
  '/api/facilities/:facilityId/modules/module_two/settings',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;
    res.json(await getOrCreateModuleTwoSettings(facilityId));
  })
);

app.put(
  '/api/facilities/:facilityId/modules/module_two/settings',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;
    const body = req.body as Partial<ModuleTwoSettingsPayload> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'بيانات إعدادات البرنامج التدريبي غير صالحة.' });
      return;
    }
    res.json(await saveModuleTwoSettings(facilityId, body));
  })
);

app.get(
  '/api/facilities/:facilityId/modules/module_three/settings',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;
    res.json(await getOrCreateModuleThreeSettings(facilityId));
  })
);

app.put(
  '/api/facilities/:facilityId/modules/module_three/settings',
  authenticate,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const facilityId = await resolveAuthorizedFacility(req, res, req.params.facilityId);
    if (!facilityId) return;
    const body = req.body as Partial<ModuleThreeSettingsPayload> | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'بيانات إعدادات إحصائية غسيل الأيدي غير صالحة.' });
      return;
    }
    res.json(await saveModuleThreeSettings(facilityId, body));
  })
);

// ============================================================================
// 17. TURSO CLOUD STATUS, FULL BACKUP & RESTORE (ADMIN TOOLS)
// ============================================================================
const BACKUP_TABLES = [
  'facilities',
  'users',
  'facility_leaders',
  'facility_master_settings',
  'module_one_settings',
  'module_two_settings',
  'module_three_settings',
  'facility_departments',
  'facility_staff',
  'module_one_records',
  'module_two_records',
  'module_three_records',
] as const;

app.get(
  '/api/admin/turso/status',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (_req, res) => {
    const latency_ms = await db.ping();
    const countOf = async (table: string): Promise<number> => {
      const row = await db.get<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ${table}`);
      return Number(row?.cnt || 0);
    };

    const [
      facilities,
      users,
      facility_departments,
      facility_staff,
      module_one_records,
      module_two_records,
      module_three_records,
      module_one_settings,
      module_two_settings,
      module_three_settings,
    ] = await Promise.all([
      countOf('facilities'),
      countOf('users'),
      countOf('facility_departments'),
      countOf('facility_staff'),
      countOf('module_one_records'),
      countOf('module_two_records'),
      countOf('module_three_records'),
      countOf('module_one_settings'),
      countOf('module_two_settings'),
      countOf('module_three_settings'),
    ]);

    const facilitiesList = await db.all<{ id: string; name: string; code: string; governorate: string }>(
      'SELECT id, name, code, governorate FROM facilities ORDER BY created_at ASC'
    );
    const facilities_summary = await Promise.all(
      facilitiesList.map(async (f) => {
        const [deps, stf, m1, m2, m3] = await Promise.all([
          db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM facility_departments WHERE facility_id = ?', [f.id]),
          db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM facility_staff WHERE facility_id = ?', [f.id]),
          db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM module_one_records WHERE facility_id = ?', [f.id]),
          db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM module_two_records WHERE facility_id = ?', [f.id]),
          db.get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM module_three_records WHERE facility_id = ?', [f.id]),
        ]);
        return {
          id: f.id,
          name: f.name,
          code: f.code,
          governorate: f.governorate,
          departments_count: Number(deps?.cnt || 0),
          staff_count: Number(stf?.cnt || 0),
          module_one_count: Number(m1?.cnt || 0),
          module_two_count: Number(m2?.cnt || 0),
          module_three_count: Number(m3?.cnt || 0),
        };
      })
    );

    res.json({
      ...dbMeta,
      connected: true,
      latency_ms,
      checked_at: new Date().toISOString(),
      counts: {
        facilities,
        users,
        facility_departments,
        facility_staff,
        module_one_records,
        module_two_records,
        module_three_records,
        module_one_settings,
        module_two_settings,
        module_three_settings,
      },
      facilities_summary,
    });
  })
);

app.get(
  '/api/admin/turso/backup',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (_req, res) => {
    const tables: Record<string, Array<Record<string, unknown>>> = {};
    for (const tbl of BACKUP_TABLES) {
      if (tbl === 'users') {
        tables[tbl] = await db.all(
          'SELECT id, name, email, role, facility_id, created_at FROM users ORDER BY created_at ASC'
        );
      } else {
        tables[tbl] = await db.all(`SELECT * FROM ${tbl}`);
      }
    }

    res.json({
      format: 'medhub_turso_backup_v1',
      exported_at: new Date().toISOString(),
      provider: dbMeta.provider,
      tables,
    });
  })
);

app.post(
  '/api/admin/turso/restore',
  authenticate,
  requireSuperAdmin,
  asyncRoute<AuthedRequest>(async (req, res) => {
    const { mode = 'merge', backup } = req.body as {
      mode?: 'merge' | 'replace';
      backup?: { format?: string; tables?: Record<string, Array<Record<string, unknown>>> };
    };

    if (!backup || typeof backup !== 'object' || !backup.tables || typeof backup.tables !== 'object') {
      res.status(400).json({ error: 'صيغة ملف النسخة الاحتياطية غير صالحة للاستعادة.' });
      return;
    }

    const restoreMode = mode === 'replace' ? 'replace' : 'merge';
    const srcTables = backup.tables;
    const restored_counts: Record<string, number> = {};
    for (const t of BACKUP_TABLES) restored_counts[t] = 0;

    const toJsonText = (v: unknown, fallback = '{}'): string => {
      if (typeof v === 'string') return v;
      if (v === undefined || v === null) return fallback;
      return JSON.stringify(v);
    };

    const rowsOf = (name: string): Array<Record<string, unknown>> =>
      Array.isArray(srcTables[name]) ? srcTables[name] : [];

    await db.transaction(async (tx) => {
      if (restoreMode === 'replace') {
        await tx.run('DELETE FROM module_three_records');
        await tx.run('DELETE FROM module_two_records');
        await tx.run('DELETE FROM module_one_records');
        await tx.run('DELETE FROM facility_staff');
        await tx.run('DELETE FROM facility_departments');
        await tx.run('DELETE FROM module_three_settings');
        await tx.run('DELETE FROM module_two_settings');
        await tx.run('DELETE FROM module_one_settings');
        await tx.run('DELETE FROM facility_master_settings');
        await tx.run('DELETE FROM facility_leaders');
        await tx.run('DELETE FROM users WHERE id != ?', [req.auth!.id]);
        await tx.run('DELETE FROM facilities');
      }

      const facIdMap = new Map<string, string>();
      const deptIdMap = new Map<string, string>();

      // 1. facilities
      for (const r of rowsOf('facilities')) {
        const id = String(r.id || '').trim() || `fac-${crypto.randomUUID().slice(0, 8)}`;
        const name = String(r.name || '').trim();
        const code = String(r.code || `FAC-${crypto.randomUUID().slice(0, 4)}`).trim();
        if (!name) continue;
        const byCode = await tx.get<{ id: string }>(
          'SELECT id FROM facilities WHERE id != ? AND upper(code) = upper(?) LIMIT 1',
          [id, code]
        );
        if (byCode) {
          facIdMap.set(id, byCode.id);
          await tx.run(
            'UPDATE facilities SET name = ?, governorate = ?, right_logo_url = ?, left_logo_url = ? WHERE id = ?',
            [
              name,
              String(r.governorate || 'عام'),
              String(r.right_logo_url || ''),
              String(r.left_logo_url || ''),
              byCode.id,
            ]
          );
          restored_counts.facilities++;
          continue;
        }
        facIdMap.set(id, id);
        await tx.run(
          `INSERT INTO facilities (id, name, code, governorate, right_logo_url, left_logo_url, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             code = excluded.code,
             governorate = excluded.governorate,
             right_logo_url = excluded.right_logo_url,
             left_logo_url = excluded.left_logo_url`,
          [
            id,
            name,
            code,
            String(r.governorate || 'عام'),
            String(r.right_logo_url || ''),
            String(r.left_logo_url || ''),
            String(r.created_at || new Date().toISOString()),
          ]
        );
        restored_counts.facilities++;
      }

      const mapFacId = (rawId: unknown): string => {
        const key = String(rawId || '').trim();
        return facIdMap.get(key) || key;
      };

      // 2. users
      for (const r of rowsOf('users')) {
        const id = String(r.id || '').trim();
        const email = String(r.email || '').trim().toLowerCase();
        const name = String(r.name || '').trim();
        if (!id || !email || !name) continue;
        const role = r.role === 'facility_staff' ? 'facility_staff' : 'super_admin';
        const facId = role === 'super_admin' || !r.facility_id ? null : mapFacId(r.facility_id);
        const existingByEmail = await tx.get<{ id: string }>(
          'SELECT id FROM users WHERE lower(email) = lower(?) AND id != ? LIMIT 1',
          [email, id]
        );
        if (existingByEmail) {
          await tx.run(
            'UPDATE users SET name = ?, role = ?, facility_id = ? WHERE id = ?',
            [name, role, facId, existingByEmail.id]
          );
          restored_counts.users++;
          continue;
        }
        const pwHash =
          typeof r.password_hash === 'string' && r.password_hash.trim()
            ? r.password_hash.trim()
            : hashPassword(crypto.randomUUID());
        await tx.run(
          `INSERT INTO users (id, name, email, password_hash, role, facility_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             email = excluded.email,
             role = excluded.role,
             facility_id = excluded.facility_id`,
          [id, name, email, pwHash, role, facId, String(r.created_at || new Date().toISOString())]
        );
        restored_counts.users++;
      }

      // 3. facility_leaders
      for (const r of rowsOf('facility_leaders')) {
        const facId = mapFacId(r.facility_id);
        if (!facId) continue;
        const id = String(r.id || `ldr-${facId}`);
        await tx.run(
          `INSERT INTO facility_leaders (id, facility_id, hospital_director, quality_director, ic_supervisor, nursing_director)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(facility_id) DO UPDATE SET
             hospital_director = excluded.hospital_director,
             quality_director = excluded.quality_director,
             ic_supervisor = excluded.ic_supervisor,
             nursing_director = excluded.nursing_director`,
          [
            id,
            facId,
            String(r.hospital_director || 'غير محدد'),
            String(r.quality_director || 'غير محدد'),
            String(r.ic_supervisor || 'غير محدد'),
            String(r.nursing_director || 'غير محدد'),
          ]
        );
        restored_counts.facility_leaders++;
      }

      // 4. facility_master_settings
      for (const r of rowsOf('facility_master_settings')) {
        const facId = mapFacId(r.facility_id);
        if (!facId) continue;
        const id = String(r.id || `mset-${facId}`);
        await tx.run(
          `INSERT INTO facility_master_settings
             (id, facility_id, hospital_director, quality_director, ic_supervisor, nursing_director, logo_url, module_configs_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(facility_id) DO UPDATE SET
             hospital_director = excluded.hospital_director,
             quality_director = excluded.quality_director,
             ic_supervisor = excluded.ic_supervisor,
             nursing_director = excluded.nursing_director,
             logo_url = excluded.logo_url,
             module_configs_json = excluded.module_configs_json,
             updated_at = excluded.updated_at`,
          [
            id,
            facId,
            String(r.hospital_director || 'غير محدد'),
            String(r.quality_director || 'غير محدد'),
            String(r.ic_supervisor || 'غير محدد'),
            String(r.nursing_director || 'غير محدد'),
            String(r.logo_url || ''),
            toJsonText(r.module_configs_json, '{}'),
            String(r.updated_at || new Date().toISOString()),
          ]
        );
        restored_counts.facility_master_settings++;
      }

      // 5. module settings tables
      for (const tbl of ['module_one_settings', 'module_two_settings', 'module_three_settings'] as const) {
        const prefix = tbl === 'module_one_settings' ? 'm1set' : tbl === 'module_two_settings' ? 'm2set' : 'm3set';
        for (const r of rowsOf(tbl)) {
          const facId = mapFacId(r.facility_id);
          if (!facId) continue;
          const id = String(r.id || `${prefix}-${facId}`);
          await tx.run(
            `INSERT INTO ${tbl} (id, facility_id, payload, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(facility_id) DO UPDATE SET
               payload = excluded.payload,
               updated_at = excluded.updated_at`,
            [id, facId, toJsonText(r.payload, '{}'), String(r.updated_at || new Date().toISOString())]
          );
          restored_counts[tbl]++;
        }
      }

      // 6. facility_departments
      for (const r of rowsOf('facility_departments')) {
        const id = String(r.id || `dep-${crypto.randomUUID().slice(0, 8)}`);
        const facId = mapFacId(r.facility_id);
        const name = String(r.name || '').trim();
        if (!facId || !name) continue;
        const dup = await tx.get<{ id: string }>(
          'SELECT id FROM facility_departments WHERE facility_id = ? AND name = ? AND id != ? LIMIT 1',
          [facId, name, id]
        );
        if (dup) {
          deptIdMap.set(id, dup.id);
          await tx.run('UPDATE facility_departments SET type = ? WHERE id = ?', [
            String(r.type || 'إكلينيكي'),
            dup.id,
          ]);
          restored_counts.facility_departments++;
          continue;
        }
        deptIdMap.set(id, id);
        await tx.run(
          `INSERT INTO facility_departments (id, facility_id, name, type)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             facility_id = excluded.facility_id,
             name = excluded.name,
             type = excluded.type`,
          [id, facId, name, String(r.type || 'إكلينيكي')]
        );
        restored_counts.facility_departments++;
      }

      const mapDeptId = (rawId: unknown): string => {
        const key = String(rawId || '').trim();
        return deptIdMap.get(key) || key;
      };

      // 7. facility_staff
      for (const r of rowsOf('facility_staff')) {
        const id = String(r.id || `stf-${crypto.randomUUID().slice(0, 8)}`);
        const facId = mapFacId(r.facility_id);
        const name = String(r.name || '').trim();
        const empCode = String(r.employee_code || '').trim();
        const deptId = mapDeptId(r.department_id);
        if (!facId || !name || !empCode || !deptId) continue;
        const dup = await tx.get<{ id: string }>(
          'SELECT id FROM facility_staff WHERE facility_id = ? AND employee_code = ? AND id != ? LIMIT 1',
          [facId, empCode, id]
        );
        if (dup) {
          await tx.run(
            'UPDATE facility_staff SET name = ?, category = ?, department_id = ? WHERE id = ?',
            [name, String(r.category || 'تمريض'), deptId, dup.id]
          );
          restored_counts.facility_staff++;
          continue;
        }
        await tx.run(
          `INSERT INTO facility_staff (id, facility_id, name, employee_code, category, department_id)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             facility_id = excluded.facility_id,
             name = excluded.name,
             employee_code = excluded.employee_code,
             category = excluded.category,
             department_id = excluded.department_id`,
          [id, facId, name, empCode, String(r.category || 'تمريض'), deptId]
        );
        restored_counts.facility_staff++;
      }

      // 8. module_one_records
      for (const r of rowsOf('module_one_records')) {
        const id = String(r.id || `m1-${crypto.randomUUID()}`);
        const facId = mapFacId(r.facility_id);
        if (!facId) continue;
        await tx.run(
          `INSERT INTO module_one_records
             (id, facility_id, staff_id, department_id, legacy_id, created_by, payload, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             facility_id = excluded.facility_id,
             staff_id = excluded.staff_id,
             department_id = excluded.department_id,
             legacy_id = excluded.legacy_id,
             payload = excluded.payload,
             status = excluded.status,
             created_at = excluded.created_at`,
          [
            id,
            facId,
            String(r.staff_id || 'unassigned'),
            mapDeptId(r.department_id) || 'unassigned',
            r.legacy_id ? String(r.legacy_id) : null,
            String(r.created_by || req.auth!.id),
            toJsonText(r.payload, '{}'),
            String(r.status || 'completed'),
            String(r.created_at || new Date().toISOString()),
          ]
        );
        restored_counts.module_one_records++;
      }

      // 9. module_two_records & module_three_records
      for (const tbl of ['module_two_records', 'module_three_records'] as const) {
        const prefix = tbl === 'module_two_records' ? 'm2' : 'm3';
        for (const r of rowsOf(tbl)) {
          const id = String(r.id || `${prefix}-${crypto.randomUUID()}`);
          const facId = mapFacId(r.facility_id);
          if (!facId) continue;
          await tx.run(
            `INSERT INTO ${tbl}
               (id, facility_id, department_id, legacy_id, created_by, payload, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               facility_id = excluded.facility_id,
               department_id = excluded.department_id,
               legacy_id = excluded.legacy_id,
               payload = excluded.payload,
               status = excluded.status,
               created_at = excluded.created_at`,
            [
              id,
              facId,
              mapDeptId(r.department_id) || 'unassigned',
              r.legacy_id ? String(r.legacy_id) : null,
              String(r.created_by || req.auth!.id),
              toJsonText(r.payload, '{}'),
              String(r.status || 'completed'),
              String(r.created_at || new Date().toISOString()),
            ]
          );
          restored_counts[tbl]++;
        }
      }
    });

    const total_restored = Object.values(restored_counts).reduce((sum, v) => sum + v, 0);
    res.json({
      mode: restoreMode,
      provider: dbMeta.provider,
      restored_counts,
      total_restored,
    });
  })
);

app.get('/api/drive-image', async (req: Request, res: Response) => {
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
    res.status(400).send('Invalid file id');
    return;
  }
  try {
    const upstream = await fetch(`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w400`);
    if (!upstream.ok) {
      res.status(upstream.status).send('Image unavailable');
      return;
    }
    const contentType = upstream.headers.get('content-type') || 'image/png';
    const arrayBuffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(arrayBuffer));
  } catch {
    res.status(502).send('Failed to proxy image');
  }
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled server error:', err);
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : 'حدث خطأ داخلي في الخادم.';
  res.status(500).json({ error: message });
});

async function startServer() {
  await ensureDbReady();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('/{*path}', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Unified Healthcare Portal server running on http://0.0.0.0:${PORT} (${dbMeta.provider})`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

export { app };
export default app;
