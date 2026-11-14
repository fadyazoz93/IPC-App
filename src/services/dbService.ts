import {
  Facility,
  FacilityDepartment,
  FacilityLeaders,
  FacilityStaffMember,
  MasterDataBundle,
  MigrationSummary,
  ModuleKey,
  ModuleOneRecord,
  ModuleThreeRecord,
  ModuleTwoRecord,
  OverviewStats,
  PortalUser,
  SessionState,
  SmartMigrationTableEntry,
  TursoBackupBundle,
  TursoRestoreSummary,
  TursoStatusInfo,
} from '../types/portal';
import type {
  CacheMetrics,
  CopyMonthlyReportResult,
  ReportDataRow,
  SettingsData as ModuleOneSettingsData,
  WeeklyReportPayload,
} from '../modules/Reports';
import type {
  Employee as TrainingEmployee,
  SettingItem as TrainingSettingItem,
  TrainingData,
} from '../modules/Training';
import type {
  AppSettings as ModuleThreeAppSettings,
  SaveResult as HhSaveResult,
  SaveSessionPayload as HhSaveSessionPayload,
  SessionDataRecord as HhSessionDataRecord,
  UpdateSessionDatePayload as HhUpdateSessionDatePayload,
  UpdateSessionDateResult as HhUpdateSessionDateResult,
  UpdateSessionDepartmentPayload as HhUpdateSessionDepartmentPayload,
} from '../modules/Compliance';

export interface ModuleTwoSettingsBundle {
  settings: TrainingSettingItem[];
  categories: string[];
  employees?: TrainingEmployee[];
}

const TOKEN_STORAGE_KEY = 'medhub_session_token';
const ACTIVE_FACILITY_STORAGE_KEY = 'medhub_active_facility_id';

type ModuleRecordMap = {
  module_one: ModuleOneRecord;
  module_two: ModuleTwoRecord;
  module_three: ModuleThreeRecord;
};

class UnifiedDbService {
  private token: string | null = null;
  private masterCache = new Map<string, MasterDataBundle>();
  private overviewCache = new Map<string, OverviewStats>();
  private moduleCache = new Map<string, Partial<Record<ModuleKey, unknown[]>>>();
  private moduleOneSettingsCache = new Map<string, ModuleOneSettingsData>();
  private moduleTwoSettingsCache = new Map<string, ModuleTwoSettingsBundle>();
  private moduleThreeSettingsCache = new Map<string, ModuleThreeAppSettings>();
  private reportRowsCache = new Map<string, Map<string, ReportDataRow[]>>();
  private trainingCache = new Map<string, TrainingData>();
  private hhSessionsCache = new Map<string, HhSessionDataRecord[]>();
  private reportCacheHits = 0;
  private reportCacheTotal = 0;
  private inFlightRequests = new Map<string, Promise<unknown>>();

  constructor() {
    if (typeof window !== 'undefined') {
      this.token = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async request<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...(options?.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((body as { error?: string }).error || 'حدث خطأ أثناء الاتصال بالخادم.');
    }
    return body as T;
  }

  public getStoredActiveFacilityId(): string | null {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(ACTIVE_FACILITY_STORAGE_KEY);
  }

  public setStoredActiveFacilityId(facilityId: string): void {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(ACTIVE_FACILITY_STORAGE_KEY, facilityId);
    }
  }

  public clearAllCaches(): void {
    this.masterCache.clear();
    this.overviewCache.clear();
    this.moduleCache.clear();
    this.moduleOneSettingsCache.clear();
    this.moduleTwoSettingsCache.clear();
    this.moduleThreeSettingsCache.clear();
    this.reportRowsCache.clear();
    this.trainingCache.clear();
    this.hhSessionsCache.clear();
    this.reportCacheHits = 0;
    this.reportCacheTotal = 0;
    this.inFlightRequests.clear();
  }

  public invalidateFacilityCache(facilityId: string): void {
    this.masterCache.delete(facilityId);
    this.overviewCache.delete(facilityId);
    this.moduleCache.delete(facilityId);
    this.moduleOneSettingsCache.delete(facilityId);
    this.moduleTwoSettingsCache.delete(facilityId);
    this.moduleThreeSettingsCache.delete(facilityId);
    this.reportRowsCache.delete(facilityId);
    this.trainingCache.delete(facilityId);
    this.hhSessionsCache.delete(facilityId);
  }

  // --- Auth & Public Facilities ---
  public async getPublicFacilities(): Promise<Facility[]> {
    return this.request<Facility[]>('/api/public/facilities');
  }

  public async createPublicFacility(input: {
    name: string;
    code?: string;
    governorate?: string;
    right_logo_url?: string;
    left_logo_url?: string;
  }): Promise<Facility> {
    return this.request<Facility>('/api/public/facilities', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async updatePublicFacility(
    id: string,
    input: {
      name?: string;
      right_logo_url?: string;
      left_logo_url?: string;
    }
  ): Promise<Facility> {
    const updated = await this.request<Facility>(`/api/public/facilities/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    this.invalidateFacilityCache(id);
    return updated;
  }

  public async deletePublicFacility(id: string): Promise<void> {
    await this.request(`/api/public/facilities/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    this.invalidateFacilityCache(id);
  }

  public async loginByFacility(input: {
    facility_id?: string;
    facility_name?: string;
    access_mode?: 'facility_staff' | 'super_admin';
  }): Promise<SessionState> {
    this.clearAllCaches();
    const res = await this.request<{
      token: string;
      user: PortalUser;
      facilities: Facility[];
      active_facility_id: string;
      active_facility_name: string;
    }>('/api/auth/login-facility', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!res.token || !res.user) {
      throw new Error('استجابة تسجيل الدخول غير مكتملة من الخادم.');
    }
    this.token = res.token;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, res.token);
      window.sessionStorage.setItem(ACTIVE_FACILITY_STORAGE_KEY, res.active_facility_id);
    }
    return {
      user: res.user,
      facilities: res.facilities || [],
      active_facility_id: res.active_facility_id,
      active_facility_name: res.active_facility_name,
    };
  }

  public async login(email: string, password: string): Promise<SessionState> {
    this.clearAllCaches();
    const res = await this.request<{
      token: string;
      user: PortalUser;
      facilities: Facility[];
      active_facility_id: string;
      active_facility_name: string;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (!res.token || !res.user) {
      throw new Error('استجابة تسجيل الدخول غير مكتملة من الخادم.');
    }
    this.token = res.token;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, res.token);
      window.sessionStorage.setItem(ACTIVE_FACILITY_STORAGE_KEY, res.active_facility_id);
    }
    return {
      user: res.user,
      facilities: res.facilities || [],
      active_facility_id: res.active_facility_id,
      active_facility_name: res.active_facility_name,
    };
  }

  public async restoreSession(): Promise<SessionState | null> {
    if (!this.token) return null;
    try {
      const data = await this.request<{ user?: PortalUser; facilities?: Facility[] }>('/api/auth/me');
      if (!data.user || !data.facilities || data.facilities.length === 0) {
        this.logout();
        return null;
      }
      const storedId = this.getStoredActiveFacilityId();
      const matched =
        data.user.role === 'super_admin'
          ? data.facilities.find((f) => f.id === storedId) || data.facilities[0]
          : data.facilities.find((f) => f.id === data.user!.facility_id) || data.facilities[0];
      if (!matched) {
        this.logout();
        return null;
      }
      return {
        user: data.user,
        facilities: data.facilities,
        active_facility_id: matched.id,
        active_facility_name: matched.name,
      };
    } catch {
      this.logout();
      return null;
    }
  }

  public logout(): void {
    this.token = null;
    this.clearAllCaches();
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(ACTIVE_FACILITY_STORAGE_KEY);
    }
  }

  // --- Master Data & Unified Settings (Session Cached once per facility_id) ---
  public async getMasterData(facilityId: string, forceRefresh = false): Promise<MasterDataBundle> {
    if (!forceRefresh && this.masterCache.has(facilityId)) {
      return this.masterCache.get(facilityId)!;
    }

    const flightKey = `master:${facilityId}`;
    if (!forceRefresh && this.inFlightRequests.has(flightKey)) {
      return this.inFlightRequests.get(flightKey) as Promise<MasterDataBundle>;
    }

    const reqPromise = this.request<MasterDataBundle>(
      `/api/facilities/${encodeURIComponent(facilityId)}/master-data`
    )
      .then((bundle) => {
        this.masterCache.set(facilityId, bundle);
        return bundle;
      })
      .finally(() => {
        this.inFlightRequests.delete(flightKey);
      });

    this.inFlightRequests.set(flightKey, reqPromise);
    return reqPromise;
  }

  public async updateLeaders(
    facilityId: string,
    leaders: Omit<FacilityLeaders, 'id' | 'facility_id'>
  ): Promise<FacilityLeaders> {
    const updated = await this.request<FacilityLeaders>(
      `/api/facilities/${encodeURIComponent(facilityId)}/leaders`,
      {
        method: 'PUT',
        body: JSON.stringify(leaders),
      }
    );
    const cached = this.masterCache.get(facilityId);
    if (cached) {
      this.masterCache.set(facilityId, {
        ...cached,
        leaders: updated,
        settings: {
          ...cached.settings,
          hospital_director: updated.hospital_director,
          quality_director: updated.quality_director,
          ic_supervisor: updated.ic_supervisor,
          nursing_director: updated.nursing_director,
        },
      });
    }
    return updated;
  }

  // --- Isolated Per-Module Settings (Session Cached per facility_id) ---
  public async getModuleOneSettings(
    facilityId: string,
    forceRefresh = false
  ): Promise<ModuleOneSettingsData> {
    if (!forceRefresh && this.moduleOneSettingsCache.has(facilityId)) {
      return this.moduleOneSettingsCache.get(facilityId)!;
    }

    const flightKey = `m1-settings:${facilityId}`;
    if (!forceRefresh && this.inFlightRequests.has(flightKey)) {
      return this.inFlightRequests.get(flightKey) as Promise<ModuleOneSettingsData>;
    }

    const reqPromise = this.request<ModuleOneSettingsData>(
      `/api/facilities/${encodeURIComponent(facilityId)}/modules/module_one/settings`
    )
      .then((settings) => {
        this.moduleOneSettingsCache.set(facilityId, settings);
        return settings;
      })
      .finally(() => {
        this.inFlightRequests.delete(flightKey);
      });

    this.inFlightRequests.set(flightKey, reqPromise);
    return reqPromise;
  }

  public async saveModuleOneSettings(
    facilityId: string,
    settings: Partial<ModuleOneSettingsData>
  ): Promise<ModuleOneSettingsData> {
    const saved = await this.request<ModuleOneSettingsData>(
      `/api/facilities/${encodeURIComponent(facilityId)}/modules/module_one/settings`,
      {
        method: 'PUT',
        body: JSON.stringify(settings),
      }
    );
    this.moduleOneSettingsCache.set(facilityId, saved);
    return saved;
  }

  public async getModuleTwoSettings(
    facilityId: string,
    forceRefresh = false
  ): Promise<ModuleTwoSettingsBundle> {
    if (!forceRefresh && this.moduleTwoSettingsCache.has(facilityId)) {
      return this.moduleTwoSettingsCache.get(facilityId)!;
    }

    const flightKey = `m2-settings:${facilityId}`;
    if (!forceRefresh && this.inFlightRequests.has(flightKey)) {
      return this.inFlightRequests.get(flightKey) as Promise<ModuleTwoSettingsBundle>;
    }

    const reqPromise = this.request<ModuleTwoSettingsBundle>(
      `/api/facilities/${encodeURIComponent(facilityId)}/modules/module_two/settings`
    )
      .then((settings) => {
        this.moduleTwoSettingsCache.set(facilityId, settings);
        return settings;
      })
      .finally(() => {
        this.inFlightRequests.delete(flightKey);
      });

    this.inFlightRequests.set(flightKey, reqPromise);
    return reqPromise;
  }

  public async saveModuleTwoSettings(
    facilityId: string,
    settings: Partial<ModuleTwoSettingsBundle>
  ): Promise<ModuleTwoSettingsBundle> {
    const saved = await this.request<ModuleTwoSettingsBundle>(
      `/api/facilities/${encodeURIComponent(facilityId)}/modules/module_two/settings`,
      {
        method: 'PUT',
        body: JSON.stringify(settings),
      }
    );
    this.moduleTwoSettingsCache.set(facilityId, saved);
    this.trainingCache.delete(facilityId);
    return saved;
  }

  public async getModuleThreeSettings(
    facilityId: string,
    forceRefresh = false
  ): Promise<ModuleThreeAppSettings> {
    if (!forceRefresh && this.moduleThreeSettingsCache.has(facilityId)) {
      return this.moduleThreeSettingsCache.get(facilityId)!;
    }

    const flightKey = `m3-settings:${facilityId}`;
    if (!forceRefresh && this.inFlightRequests.has(flightKey)) {
      return this.inFlightRequests.get(flightKey) as Promise<ModuleThreeAppSettings>;
    }

    const reqPromise = this.request<ModuleThreeAppSettings>(
      `/api/facilities/${encodeURIComponent(facilityId)}/modules/module_three/settings`
    )
      .then((settings) => {
        this.moduleThreeSettingsCache.set(facilityId, settings);
        return settings;
      })
      .finally(() => {
        this.inFlightRequests.delete(flightKey);
      });

    this.inFlightRequests.set(flightKey, reqPromise);
    return reqPromise;
  }

  public async saveModuleThreeSettings(
    facilityId: string,
    settings: Partial<ModuleThreeAppSettings>
  ): Promise<ModuleThreeAppSettings> {
    const saved = await this.request<ModuleThreeAppSettings>(
      `/api/facilities/${encodeURIComponent(facilityId)}/modules/module_three/settings`,
      {
        method: 'PUT',
        body: JSON.stringify(settings),
      }
    );
    this.moduleThreeSettingsCache.set(facilityId, saved);
    return saved;
  }

  public async createDepartment(
    facilityId: string,
    input: { name: string; type: FacilityDepartment['type'] }
  ): Promise<FacilityDepartment> {
    const created = await this.request<FacilityDepartment>(
      `/api/facilities/${encodeURIComponent(facilityId)}/departments`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    const cached = this.masterCache.get(facilityId);
    if (cached) {
      this.masterCache.set(facilityId, {
        ...cached,
        departments: [...cached.departments, created].sort((a, b) => a.name.localeCompare(b.name, 'ar')),
      });
    }
    this.overviewCache.delete(facilityId);
    return created;
  }

  public async updateDepartment(
    facilityId: string,
    id: string,
    input: Partial<Pick<FacilityDepartment, 'name' | 'type'>>
  ): Promise<FacilityDepartment> {
    const updated = await this.request<FacilityDepartment>(
      `/api/facilities/${encodeURIComponent(facilityId)}/departments/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    );
    const cached = this.masterCache.get(facilityId);
    if (cached) {
      this.masterCache.set(facilityId, {
        ...cached,
        departments: cached.departments.map((d) => (d.id === id ? updated : d)),
      });
    }
    this.overviewCache.delete(facilityId);
    return updated;
  }

  public async deleteDepartment(facilityId: string, id: string): Promise<void> {
    await this.request(
      `/api/facilities/${encodeURIComponent(facilityId)}/departments/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
    const cached = this.masterCache.get(facilityId);
    if (cached) {
      this.masterCache.set(facilityId, {
        ...cached,
        departments: cached.departments.filter((d) => d.id !== id),
        staff: cached.staff.filter((s) => s.department_id !== id),
      });
    }
    this.overviewCache.delete(facilityId);
  }

  public async createStaff(
    facilityId: string,
    input: Omit<FacilityStaffMember, 'id' | 'facility_id'>
  ): Promise<FacilityStaffMember> {
    const created = await this.request<FacilityStaffMember>(
      `/api/facilities/${encodeURIComponent(facilityId)}/staff`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    const cached = this.masterCache.get(facilityId);
    if (cached) {
      this.masterCache.set(facilityId, {
        ...cached,
        staff: [...cached.staff, created].sort((a, b) => a.name.localeCompare(b.name, 'ar')),
      });
    }
    this.overviewCache.delete(facilityId);
    return created;
  }

  public async updateStaff(
    facilityId: string,
    id: string,
    input: Partial<Omit<FacilityStaffMember, 'id' | 'facility_id'>>
  ): Promise<FacilityStaffMember> {
    const updated = await this.request<FacilityStaffMember>(
      `/api/facilities/${encodeURIComponent(facilityId)}/staff/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    );
    const cached = this.masterCache.get(facilityId);
    if (cached) {
      this.masterCache.set(facilityId, {
        ...cached,
        staff: cached.staff.map((s) => (s.id === id ? updated : s)),
      });
    }
    return updated;
  }

  public async deleteStaff(facilityId: string, id: string): Promise<void> {
    await this.request(
      `/api/facilities/${encodeURIComponent(facilityId)}/staff/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
    const cached = this.masterCache.get(facilityId);
    if (cached) {
      this.masterCache.set(facilityId, {
        ...cached,
        staff: cached.staff.filter((s) => s.id !== id),
      });
    }
    this.overviewCache.delete(facilityId);
  }

  // --- Lightweight Overview Aggregation ---
  public async getOverviewStats(facilityId: string, forceRefresh = false): Promise<OverviewStats> {
    if (!forceRefresh && this.overviewCache.has(facilityId)) {
      return this.overviewCache.get(facilityId)!;
    }

    const flightKey = `overview:${facilityId}`;
    if (!forceRefresh && this.inFlightRequests.has(flightKey)) {
      return this.inFlightRequests.get(flightKey) as Promise<OverviewStats>;
    }

    const reqPromise = this.request<OverviewStats>(
      `/api/facilities/${encodeURIComponent(facilityId)}/overview`
    )
      .then((stats) => {
        this.overviewCache.set(facilityId, stats);
        return stats;
      })
      .finally(() => {
        this.inFlightRequests.delete(flightKey);
      });

    this.inFlightRequests.set(flightKey, reqPromise);
    return reqPromise;
  }

  // --- Lazy Per-Module Fetching & Optimistic Cache Updates ---
  public async getModuleRecords<K extends ModuleKey>(
    facilityId: string,
    moduleKey: K,
    forceRefresh = false
  ): Promise<ModuleRecordMap[K][]> {
    const facCache = this.moduleCache.get(facilityId);
    if (!forceRefresh && facCache && facCache[moduleKey]) {
      return facCache[moduleKey] as ModuleRecordMap[K][];
    }

    const flightKey = `module:${facilityId}:${moduleKey}`;
    if (!forceRefresh && this.inFlightRequests.has(flightKey)) {
      return this.inFlightRequests.get(flightKey) as Promise<ModuleRecordMap[K][]>;
    }

    const reqPromise = this.request<ModuleRecordMap[K][]>(
      `/api/facilities/${encodeURIComponent(facilityId)}/modules/${moduleKey}`
    )
      .then((rows) => {
        const current = this.moduleCache.get(facilityId) || {};
        current[moduleKey] = rows;
        this.moduleCache.set(facilityId, current);
        return rows;
      })
      .finally(() => {
        this.inFlightRequests.delete(flightKey);
      });

    this.inFlightRequests.set(flightKey, reqPromise);
    return reqPromise;
  }

  public async createModuleRecord<K extends ModuleKey>(
    facilityId: string,
    moduleKey: K,
    input: {
      staff_id?: string;
      department_id: string;
      payload: ModuleRecordMap[K]['payload'];
      status: ModuleRecordMap[K]['status'];
    }
  ): Promise<ModuleRecordMap[K]> {
    const created = await this.request<ModuleRecordMap[K]>(
      `/api/facilities/${encodeURIComponent(facilityId)}/modules/${moduleKey}`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
    const facCache = this.moduleCache.get(facilityId) || {};
    const existing = (facCache[moduleKey] as ModuleRecordMap[K][] | undefined) || [];
    facCache[moduleKey] = [created, ...existing];
    this.moduleCache.set(facilityId, facCache);
    this.overviewCache.delete(facilityId);
    return created;
  }

  public async updateModuleRecord<K extends ModuleKey>(
    facilityId: string,
    moduleKey: K,
    recordId: string,
    patch: {
      staff_id?: string;
      department_id?: string;
      payload?: Partial<ModuleRecordMap[K]['payload']>;
      status?: ModuleRecordMap[K]['status'];
    }
  ): Promise<ModuleRecordMap[K]> {
    const updated = await this.request<ModuleRecordMap[K]>(
      `/api/facilities/${encodeURIComponent(facilityId)}/modules/${moduleKey}/${encodeURIComponent(recordId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }
    );
    const facCache = this.moduleCache.get(facilityId);
    if (facCache && facCache[moduleKey]) {
      facCache[moduleKey] = (facCache[moduleKey] as ModuleRecordMap[K][]).map((r) =>
        r.id === recordId ? updated : r
      );
    }
    this.overviewCache.delete(facilityId);
    return updated;
  }

  public async deleteModuleRecord(facilityId: string, moduleKey: ModuleKey, recordId: string): Promise<void> {
    await this.request(
      `/api/facilities/${encodeURIComponent(facilityId)}/modules/${moduleKey}/${encodeURIComponent(recordId)}`,
      {
        method: 'DELETE',
      }
    );
    const facCache = this.moduleCache.get(facilityId);
    if (facCache && facCache[moduleKey]) {
      facCache[moduleKey] = (facCache[moduleKey] as Array<{ id: string }>).filter((r) => r.id !== recordId);
    }
    this.overviewCache.delete(facilityId);
  }

  // --- Super Admin: Facilities & Users ---
  public async getFacilities(): Promise<Facility[]> {
    return this.request<Facility[]>('/api/facilities');
  }

  public async createFacility(input: { name: string; code?: string; governorate?: string }): Promise<Facility> {
    return this.request<Facility>('/api/facilities', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async deleteFacility(id: string): Promise<void> {
    await this.request(`/api/facilities/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    this.invalidateFacilityCache(id);
  }

  public async getUsers(): Promise<PortalUser[]> {
    return this.request<PortalUser[]>('/api/admin/users');
  }

  public async createUser(input: {
    name: string;
    email: string;
    password: string;
    role: PortalUser['role'];
    facility_id: string | null;
  }): Promise<PortalUser> {
    return this.request<PortalUser>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  public async updateUser(
    id: string,
    input: { name?: string; role?: PortalUser['role']; facility_id?: string | null }
  ): Promise<PortalUser> {
    return this.request<PortalUser>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  }

  // --- Super Admin: Smart 2-Phase Migration Tool ---
  public async executeSmartMigration(
    facilityId: string,
    tables: SmartMigrationTableEntry[]
  ): Promise<MigrationSummary> {
    const summary = await this.request<MigrationSummary>('/api/admin/migrate/smart', {
      method: 'POST',
      body: JSON.stringify({ facility_id: facilityId, tables }),
    });
    this.invalidateFacilityCache(facilityId);
    return summary;
  }

  public async migrateFullFacility(
    facilityId: string,
    data: Record<string, unknown>
  ): Promise<MigrationSummary> {
    const summary = await this.request<MigrationSummary>('/api/admin/migrate/full', {
      method: 'POST',
      body: JSON.stringify({ facility_id: facilityId, data }),
    });
    this.invalidateFacilityCache(facilityId);
    return summary;
  }

  public async migrateSingleModule(
    facilityId: string,
    moduleKey: ModuleKey,
    records: Array<Record<string, unknown>>
  ): Promise<MigrationSummary> {
    const summary = await this.request<MigrationSummary>('/api/admin/migrate/module', {
      method: 'POST',
      body: JSON.stringify({ facility_id: facilityId, module_key: moduleKey, records }),
    });
    this.overviewCache.delete(facilityId);
    const facCache = this.moduleCache.get(facilityId);
    if (facCache) {
      delete facCache[moduleKey];
    }
    return summary;
  }

  // --- Module One: Inspection Reports (تقارير المرور) ---
  public async saveWeeklyReport(facilityId: string, report: WeeklyReportPayload): Promise<void> {
    const res = await this.request<{ id: string; status: string; created_at: string }>(
      `/api/facilities/${encodeURIComponent(facilityId)}/reports/weekly`,
      {
        method: 'POST',
        body: JSON.stringify(report),
      }
    );

    // Optimistic in-place cache update for any cached query keys containing report.date
    const facRows = this.reportRowsCache.get(facilityId);
    if (facRows && facRows.size > 0) {
      const createdTs = res.created_at || new Date().toISOString();
      const newRows: ReportDataRow[] = (report.evaluations || []).map((ev, idx) => [
        report.date,
        createdTs,
        `${res.id || 'm1-local'}#${idx}`,
        report.period,
        report.department,
        report.inspector,
        report.supervisor,
        ev.procedure || ev.note || 'إجراء تقييم',
        ev.status === 'No' ? 'No' : 'Yes',
        ev.note || '',
        ev.rec || '',
      ]);

      for (const [cacheKey, existingRows] of facRows.entries()) {
        const [qType, qParam] = cacheKey.split(':', 2);
        let matches = false;
        if (qType === 'monthly' && report.date.startsWith(qParam)) matches = true;
        else if (qType === 'yearly' && report.date.startsWith(qParam)) matches = true;
        else if (qType === 'range' && qParam.includes('..')) {
          const [start, end] = qParam.split('..');
          if ((!start || report.date >= start) && (!end || report.date <= end)) matches = true;
        }
        if (matches) {
          facRows.set(
            cacheKey,
            [...existingRows, ...newRows].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
          );
        }
      }
    }

    this.overviewCache.delete(facilityId);
    const facCache = this.moduleCache.get(facilityId);
    if (facCache) {
      delete facCache.module_one;
    }
  }

  public async updateWeeklyReport(
    facilityId: string,
    recordId: string,
    report: WeeklyReportPayload
  ): Promise<void> {
    const res = await this.request<{ id: string; status: string; created_at: string }>(
      `/api/facilities/${encodeURIComponent(facilityId)}/reports/weekly/${encodeURIComponent(recordId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(report),
      }
    );

    const facRows = this.reportRowsCache.get(facilityId);
    if (facRows && facRows.size > 0) {
      const createdTs = res.created_at || new Date().toISOString();
      const updatedRows: ReportDataRow[] = (report.evaluations || []).map((ev, idx) => [
        report.date,
        createdTs,
        `${recordId}#${idx}`,
        report.period,
        report.department,
        report.inspector,
        report.supervisor,
        ev.procedure || ev.note || 'إجراء تقييم',
        ev.status === 'No' ? 'No' : 'Yes',
        ev.note || '',
        ev.rec || '',
      ]);

      for (const [cacheKey, existingRows] of facRows.entries()) {
        const filtered = existingRows.filter((r) => String(r[2] || '').split('#')[0] !== recordId);
        const [qType, qParam] = cacheKey.split(':', 2);
        let matches = false;
        if (qType === 'monthly' && report.date.startsWith(qParam)) matches = true;
        else if (qType === 'yearly' && report.date.startsWith(qParam)) matches = true;
        else if (qType === 'range' && qParam.includes('..')) {
          const [start, end] = qParam.split('..');
          if ((!start || report.date >= start) && (!end || report.date <= end)) matches = true;
        }
        facRows.set(
          cacheKey,
          matches
            ? [...filtered, ...updatedRows].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
            : filtered
        );
      }
    }

    this.overviewCache.delete(facilityId);
    const facCache = this.moduleCache.get(facilityId);
    if (facCache) {
      delete facCache.module_one;
    }
  }

  public async deleteWeeklyReports(facilityId: string, recordIds: string[]): Promise<void> {
    const uniqueIds = Array.from(new Set(recordIds.map((id) => id.trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return;

    await Promise.all(
      uniqueIds.map((recordId) =>
        this.request<{ deleted: boolean }>(
          `/api/facilities/${encodeURIComponent(facilityId)}/reports/weekly/${encodeURIComponent(recordId)}`,
          { method: 'DELETE' }
        )
      )
    );

    const idSet = new Set(uniqueIds);
    const facRows = this.reportRowsCache.get(facilityId);
    if (facRows && facRows.size > 0) {
      for (const [cacheKey, existingRows] of facRows.entries()) {
        facRows.set(
          cacheKey,
          existingRows.filter((r) => !idSet.has(String(r[2] || '').split('#')[0]))
        );
      }
    }

    this.overviewCache.delete(facilityId);
    const facCache = this.moduleCache.get(facilityId);
    if (facCache) {
      delete facCache.module_one;
    }
  }

  public async fetchReportRows(
    facilityId: string,
    type: 'monthly' | 'yearly' | 'range',
    params: string | { start: string; end: string }
  ): Promise<ReportDataRow[]> {
    const cacheKey = `${type}:${typeof params === 'string' ? params : `${params.start}..${params.end}`}`;
    this.reportCacheTotal++;
    const facRows = this.reportRowsCache.get(facilityId);
    if (facRows?.has(cacheKey)) {
      this.reportCacheHits++;
      return facRows.get(cacheKey)!;
    }

    const rows = await this.request<ReportDataRow[]>(
      `/api/facilities/${encodeURIComponent(facilityId)}/reports/query`,
      {
        method: 'POST',
        body: JSON.stringify({ type, params }),
      }
    );
    const map = this.reportRowsCache.get(facilityId) || new Map<string, ReportDataRow[]>();
    map.set(cacheKey, rows);
    this.reportRowsCache.set(facilityId, map);
    return rows;
  }

  public async copyMonthlyReport(
    facilityId: string,
    sourceMonth: string,
    targetMonth: string,
    replaceExisting: boolean
  ): Promise<CopyMonthlyReportResult> {
    const res = await this.request<CopyMonthlyReportResult>(
      `/api/facilities/${encodeURIComponent(facilityId)}/reports/copy-month`,
      {
        method: 'POST',
        body: JSON.stringify({ sourceMonth, targetMonth, replaceExisting }),
      }
    );

    const facRows = this.reportRowsCache.get(facilityId) || new Map<string, ReportDataRow[]>();
    if (Array.isArray(res.rows)) {
      facRows.set(`monthly:${targetMonth}`, res.rows);
      // Invalidate yearly/range keys that might span targetMonth
      for (const k of Array.from(facRows.keys())) {
        if (!k.startsWith('monthly:')) facRows.delete(k);
      }
      this.reportRowsCache.set(facilityId, facRows);
    } else {
      this.reportRowsCache.delete(facilityId);
    }
    this.overviewCache.delete(facilityId);
    return res;
  }

  public async getReportCacheMetrics(): Promise<CacheMetrics> {
    const pct =
      this.reportCacheTotal > 0
        ? Math.round((this.reportCacheHits / this.reportCacheTotal) * 100)
        : 100;
    return {
      hitRate: `${pct}%`,
      savedCloudReads: this.reportCacheHits,
    };
  }

  // --- Module Two: Training Program (البرنامج التدريبي) ---
  public async getTrainingData(facilityId: string, forceRefresh = false): Promise<TrainingData> {
    if (!forceRefresh && this.trainingCache.has(facilityId)) {
      return this.trainingCache.get(facilityId)!;
    }

    const flightKey = `training-data:${facilityId}`;
    if (!forceRefresh && this.inFlightRequests.has(flightKey)) {
      return this.inFlightRequests.get(flightKey) as Promise<TrainingData>;
    }

    const reqPromise = this.request<TrainingData>(
      `/api/facilities/${encodeURIComponent(facilityId)}/training/data`
    )
      .then((data) => {
        this.trainingCache.set(facilityId, data);
        return data;
      })
      .finally(() => {
        this.inFlightRequests.delete(flightKey);
      });

    this.inFlightRequests.set(flightKey, reqPromise);
    return reqPromise;
  }

  public async saveTrainingData(facilityId: string, data: TrainingData): Promise<TrainingData> {
    const previous = this.trainingCache.get(facilityId);
    // Optimistic cache update
    this.trainingCache.set(facilityId, data);
    try {
      const saved = await this.request<TrainingData>(
        `/api/facilities/${encodeURIComponent(facilityId)}/training/data`,
        {
          method: 'PUT',
          body: JSON.stringify(data),
        }
      );
      this.trainingCache.set(facilityId, saved);
      this.moduleTwoSettingsCache.set(facilityId, {
        settings: saved.settings,
        categories: saved.categories,
        employees: saved.employees,
      });
      this.overviewCache.delete(facilityId);
      return saved;
    } catch (err) {
      if (previous) {
        this.trainingCache.set(facilityId, previous);
      } else {
        this.trainingCache.delete(facilityId);
      }
      throw err;
    }
  }

  // --- Module Three: Hand Hygiene Compliance (إحصائية غسيل الأيدي) ---
  public async getHandHygieneSessions(
    facilityId: string,
    forceRefresh = false
  ): Promise<HhSessionDataRecord[]> {
    if (!forceRefresh && this.hhSessionsCache.has(facilityId)) {
      return this.hhSessionsCache.get(facilityId)!;
    }

    const flightKey = `hh-sessions:${facilityId}`;
    if (!forceRefresh && this.inFlightRequests.has(flightKey)) {
      return this.inFlightRequests.get(flightKey) as Promise<HhSessionDataRecord[]>;
    }

    const reqPromise = this.request<HhSessionDataRecord[]>(
      `/api/facilities/${encodeURIComponent(facilityId)}/hand-hygiene/sessions`
    )
      .then((sessions) => {
        this.hhSessionsCache.set(facilityId, sessions);
        return sessions;
      })
      .finally(() => {
        this.inFlightRequests.delete(flightKey);
      });

    this.inFlightRequests.set(flightKey, reqPromise);
    return reqPromise;
  }

  public async saveHandHygieneSession(
    facilityId: string,
    payload: HhSaveSessionPayload
  ): Promise<HhSaveResult> {
    const res = await this.request<HhSaveResult>(
      `/api/facilities/${encodeURIComponent(facilityId)}/hand-hygiene/sessions`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );

    const cached = this.hhSessionsCache.get(facilityId);
    if (cached) {
      const { professionals, ...info } = payload;
      const sid = res.sessionId || info.sessionId || '';
      const updatedRecord: HhSessionDataRecord = {
        sessionInfo: {
          ...info,
          sessionId: sid,
          sessionNumber: res.sessionNumber || info.sessionNumber || '1',
        },
        professionals: professionals || [],
      };
      const exists = cached.some((s) => s.sessionInfo.sessionId === sid);
      const next = exists
        ? cached.map((s) => (s.sessionInfo.sessionId === sid ? updatedRecord : s))
        : [updatedRecord, ...cached];
      this.hhSessionsCache.set(facilityId, next);
    }

    this.overviewCache.delete(facilityId);
    return res;
  }

  public async deleteHandHygieneSession(
    facilityId: string,
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> {
    const res = await this.request<{ success: boolean; error?: string }>(
      `/api/facilities/${encodeURIComponent(facilityId)}/hand-hygiene/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
      }
    );
    const cached = this.hhSessionsCache.get(facilityId);
    if (cached) {
      this.hhSessionsCache.set(
        facilityId,
        cached.filter((s) => s.sessionInfo.sessionId !== sessionId)
      );
    }
    this.overviewCache.delete(facilityId);
    return res;
  }

  public async deleteHandHygieneMonths(
    facilityId: string,
    monthKeys: string[]
  ): Promise<{ success: boolean; error?: string }> {
    const res = await this.request<{ success: boolean; error?: string }>(
      `/api/facilities/${encodeURIComponent(facilityId)}/hand-hygiene/delete-months`,
      {
        method: 'POST',
        body: JSON.stringify({ monthKeys }),
      }
    );
    const cached = this.hhSessionsCache.get(facilityId);
    if (cached) {
      this.hhSessionsCache.set(
        facilityId,
        cached.filter((s) => !monthKeys.includes(String(s.sessionInfo.date || '').slice(0, 7)))
      );
    }
    this.overviewCache.delete(facilityId);
    return res;
  }

  public async updateHandHygieneSessionDate(
    facilityId: string,
    payload: HhUpdateSessionDatePayload
  ): Promise<HhUpdateSessionDateResult> {
    const res = await this.request<HhUpdateSessionDateResult>(
      `/api/facilities/${encodeURIComponent(facilityId)}/hand-hygiene/sessions/${encodeURIComponent(payload.sessionId)}/date`,
      {
        method: 'PATCH',
        body: JSON.stringify({ newDate: payload.newDate }),
      }
    );
    const cached = this.hhSessionsCache.get(facilityId);
    if (cached) {
      const d = new Date(payload.newDate);
      const pNum = !isNaN(d.getTime()) ? String(d.getMonth() + 1) : undefined;
      this.hhSessionsCache.set(
        facilityId,
        cached.map((s) =>
          s.sessionInfo.sessionId === payload.sessionId
            ? {
                ...s,
                sessionInfo: {
                  ...s.sessionInfo,
                  date: payload.newDate,
                  periodNumber: pNum || s.sessionInfo.periodNumber,
                  sessionNumber: res.newSessionNo || s.sessionInfo.sessionNumber,
                },
              }
            : s
        )
      );
    }
    this.overviewCache.delete(facilityId);
    return res;
  }

  public async updateHandHygieneSessionDepartment(
    facilityId: string,
    payload: HhUpdateSessionDepartmentPayload
  ): Promise<{ success: boolean; error?: string }> {
    const res = await this.request<{ success: boolean; error?: string }>(
      `/api/facilities/${encodeURIComponent(facilityId)}/hand-hygiene/sessions/${encodeURIComponent(payload.sessionId)}/department`,
      {
        method: 'PATCH',
        body: JSON.stringify({ department: payload.department }),
      }
    );
    const cached = this.hhSessionsCache.get(facilityId);
    if (cached) {
      this.hhSessionsCache.set(
        facilityId,
        cached.map((s) =>
          s.sessionInfo.sessionId === payload.sessionId
            ? { ...s, sessionInfo: { ...s.sessionInfo, department: payload.department } }
            : s
        )
      );
    }
    this.overviewCache.delete(facilityId);
    return res;
  }

  // --- Turso Cloud Database Status, Backup & Restore ---
  public async getTursoStatus(): Promise<TursoStatusInfo> {
    return this.request<TursoStatusInfo>('/api/admin/turso/status');
  }

  public async downloadTursoBackup(): Promise<TursoBackupBundle> {
    return this.request<TursoBackupBundle>('/api/admin/turso/backup');
  }

  public async restoreTursoBackup(
    mode: 'merge' | 'replace',
    backup: TursoBackupBundle
  ): Promise<TursoRestoreSummary> {
    const res = await this.request<TursoRestoreSummary>('/api/admin/turso/restore', {
      method: 'POST',
      body: JSON.stringify({ mode, backup }),
    });
    this.clearAllCaches();
    return res;
  }
}

export const dbService = new UnifiedDbService();
