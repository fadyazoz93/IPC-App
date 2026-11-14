export type UserRole = 'super_admin' | 'facility_staff';

export type StaffCategory = 'طبيب' | 'تمريض' | 'إداري' | 'خدمات معاونة';

export type DepartmentType = 'إكلينيكي' | 'معاون وخدمي' | 'إداري وجودة' | 'طوارئ وعمليات';

export interface Facility {
  id: string;
  name: string;
  code: string;
  governorate: string;
  right_logo_url?: string;
  left_logo_url?: string;
  created_at: string;
}

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  facility_id: string | null;
  created_at: string;
}

export interface FacilityLeaders {
  id: string;
  facility_id: string;
  hospital_director: string;
  quality_director: string;
  ic_supervisor: string;
  nursing_director: string;
}

export interface ReportProcedureConfig {
  name: string;
  note: string;
  rec: string;
  depts: string[];
}

export interface ModuleConfigsJson {
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

export interface FacilityMasterSettings {
  id: string;
  facility_id: string;
  hospital_director: string;
  quality_director: string;
  ic_supervisor: string;
  nursing_director: string;
  logo_url: string;
  module_configs: ModuleConfigsJson;
  updated_at: string;
}

export interface FacilityDepartment {
  id: string;
  facility_id: string;
  name: string;
  type: DepartmentType;
}

export interface FacilityStaffMember {
  id: string;
  facility_id: string;
  name: string;
  employee_code: string;
  category: StaffCategory;
  department_id: string;
}

export interface MasterDataBundle {
  leaders: FacilityLeaders;
  settings: FacilityMasterSettings;
  departments: FacilityDepartment[];
  staff: FacilityStaffMember[];
}

export type ModuleOneStatus = 'completed' | 'in_progress' | 'pending';

export interface ModuleOnePayload {
  program_title?: string;
  training_type?: string;
  trainer_name?: string;
  training_date?: string;
  hours?: number;
  score?: number | null;
  notes?: string;
  report_type?: string;
  date?: string;
  period?: string;
  department?: string;
  inspector?: string;
  supervisor?: string;
  evaluations?: Array<{
    procedure?: string;
    status?: string;
    note?: string;
    rec?: string;
  }>;
  [key: string]: unknown;
}

export interface ModuleOneRecord {
  id: string;
  facility_id: string;
  staff_id: string;
  department_id: string;
  legacy_id?: string | null;
  created_by: string;
  payload: ModuleOnePayload;
  status: ModuleOneStatus | string;
  created_at: string;
}

export type ModuleTwoStatus = 'open' | 'in_progress' | 'closed' | 'training_log' | 'training_plan';
export type ObservationSeverity = 'high' | 'medium' | 'low';

export interface ModuleTwoPayload {
  round_title?: string;
  category?: string;
  severity?: ObservationSeverity;
  finding_details?: string;
  corrective_action?: string;
  responsible_name?: string;
  due_date?: string;
  record_type?: 'training_log' | 'training_plan';
  [key: string]: unknown;
}

export interface ModuleTwoRecord {
  id: string;
  facility_id: string;
  department_id: string;
  legacy_id?: string | null;
  created_by: string;
  payload: ModuleTwoPayload;
  status: ModuleTwoStatus | string;
  created_at: string;
}

export type ModuleThreeStatus = 'compliant' | 'partial' | 'needs_action' | 'hand_hygiene';

export interface ModuleThreePayload {
  standard_code?: string;
  standard_title?: string;
  chapter?: string;
  evaluated_items?: number;
  passed_items?: number;
  compliance_rate?: number;
  auditor_name?: string;
  audit_date?: string;
  recommendations?: string;
  record_type?: 'hand_hygiene';
  [key: string]: unknown;
}

export interface ModuleThreeRecord {
  id: string;
  facility_id: string;
  department_id: string;
  legacy_id?: string | null;
  created_by: string;
  payload: ModuleThreePayload;
  status: ModuleThreeStatus | string;
  created_at: string;
}

export type ModuleKey = 'module_one' | 'module_two' | 'module_three';

export interface OverviewStats {
  facility_id: string;
  staff_count: number;
  departments_count: number;
  training_total: number;
  training_completed: number;
  training_pending: number;
  training_in_progress: number;
  observations_total: number;
  observations_open: number;
  observations_in_progress: number;
  observations_closed: number;
  compliance_total: number;
  avg_compliance_rate: number;
  department_compliance: {
    department_id: string;
    department_name: string;
    compliance_rate: number;
    observations_open: number;
  }[];
}

export interface SessionState {
  user: PortalUser;
  facilities: Facility[];
  active_facility_id: string;
  active_facility_name: string;
}

export type PortalTab =
  | 'home'
  | 'module_one'
  | 'module_two'
  | 'module_three'
  | 'migration';

export interface NavigationFilterIntent {
  tab: PortalTab;
  statusFilter?: string;
  departmentFilter?: string;
}

export interface MigrationSummary {
  departments_upserted: number;
  staff_upserted: number;
  leaders_updated: number;
  settings_updated?: number;
  module_one_settings_updated?: number;
  module_two_settings_updated?: number;
  module_three_settings_updated?: number;
  module_one_upserted: number;
  module_two_upserted: number;
  module_three_upserted: number;
  duplicates_skipped: number;
}

export type MigrationTargetDestination =
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

export interface DetectedSourceTable {
  tableName: string;
  rowCount: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  suggestedTarget: MigrationTargetDestination;
}

export interface SmartMigrationTableEntry {
  sourceTable: string;
  target: MigrationTargetDestination;
  rows: Array<Record<string, unknown>>;
}

export interface TursoFacilitySummaryItem {
  id: string;
  name: string;
  code: string;
  governorate: string;
  departments_count: number;
  staff_count: number;
  module_one_count: number;
  module_two_count: number;
  module_three_count: number;
}

export interface TursoStatusInfo {
  provider: 'turso' | 'local_sqlite';
  isTursoRemote: boolean;
  isVercel: boolean;
  databaseUrlMasked: string;
  hasDatabaseUrlEnv: boolean;
  hasAuthToken: boolean;
  connected: boolean;
  latency_ms: number;
  checked_at: string;
  counts: {
    facilities: number;
    users: number;
    facility_departments: number;
    facility_staff: number;
    module_one_records: number;
    module_two_records: number;
    module_three_records: number;
    module_one_settings: number;
    module_two_settings: number;
    module_three_settings: number;
  };
  facilities_summary?: TursoFacilitySummaryItem[];
}

export interface TursoBackupBundle {
  format: 'medhub_turso_backup_v1' | string;
  exported_at: string;
  provider?: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export interface TursoRestoreSummary {
  mode: 'merge' | 'replace';
  provider: string;
  restored_counts: Record<string, number>;
  total_restored: number;
}

