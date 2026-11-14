import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { dbService } from '../services/dbService';
import {
  Facility,
  FacilityDepartment,
  FacilityLeaders,
  FacilityStaffMember,
  MasterDataBundle,
  NavigationFilterIntent,
  PortalTab,
  SessionState,
} from '../types/portal';
import { useToast } from './ToastContext';

interface FacilityContextValue {
  session: SessionState | null;
  authChecking: boolean;
  masterData: MasterDataBundle | null;
  masterLoading: boolean;
  activeTab: PortalTab;
  navigationIntent: NavigationFilterIntent | null;
  setActiveTab: (tab: PortalTab) => void;
  navigateWithFilter: (intent: NavigationFilterIntent) => void;
  clearNavigationIntent: () => void;
  login: (email: string, password: string) => Promise<void>;
  loginByFacility: (input: {
    facility_id?: string;
    facility_name?: string;
    access_mode?: 'facility_staff' | 'super_admin';
  }) => Promise<void>;
  logout: () => void;
  switchFacility: (facilityId: string) => Promise<void>;
  deleteFacility: (facilityId: string) => Promise<void>;
  refreshFacilities: () => Promise<void>;
  refreshMasterData: (force?: boolean) => Promise<void>;
  saveLeaders: (leaders: Omit<FacilityLeaders, 'id' | 'facility_id'>) => Promise<void>;
  addDepartment: (input: { name: string; type: FacilityDepartment['type'] }) => Promise<FacilityDepartment>;
  editDepartment: (
    id: string,
    input: Partial<Pick<FacilityDepartment, 'name' | 'type'>>
  ) => Promise<FacilityDepartment>;
  removeDepartment: (id: string) => Promise<void>;
  addStaff: (input: Omit<FacilityStaffMember, 'id' | 'facility_id'>) => Promise<FacilityStaffMember>;
  editStaff: (
    id: string,
    input: Partial<Omit<FacilityStaffMember, 'id' | 'facility_id'>>
  ) => Promise<FacilityStaffMember>;
  removeStaff: (id: string) => Promise<void>;
}

const FacilityContext = createContext<FacilityContextValue | null>(null);

export const FacilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const [session, setSession] = useState<SessionState | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [masterData, setMasterData] = useState<MasterDataBundle | null>(null);
  const [masterLoading, setMasterLoading] = useState(false);
  const [activeTab, setActiveTabState] = useState<PortalTab>('home');
  const [navigationIntent, setNavigationIntent] = useState<NavigationFilterIntent | null>(null);

  const loadMasterDataForFacility = useCallback(
    async (facilityId: string, force = false) => {
      setMasterLoading(true);
      try {
        const bundle = await dbService.getMasterData(facilityId, force);
        setMasterData(bundle);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'تعذر تحميل البيانات الأساسية للمركز.', 'error');
      } finally {
        setMasterLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    let active = true;
    dbService
      .restoreSession()
      .then(async (restored) => {
        if (!active) return;
        if (restored) {
          setSession(restored);
          await loadMasterDataForFacility(restored.active_facility_id);
        }
      })
      .finally(() => {
        if (active) setAuthChecking(false);
      });
    return () => {
      active = false;
    };
  }, [loadMasterDataForFacility]);

  const login = useCallback(
    async (email: string, password: string) => {
      const nextSession = await dbService.login(email, password);
      setSession(nextSession);
      setActiveTabState('home');
      setNavigationIntent(null);
      await loadMasterDataForFacility(nextSession.active_facility_id);
      showToast(`مرحباً ${nextSession.user.name} — تم الدخول إلى ${nextSession.active_facility_name}`, 'success');
    },
    [loadMasterDataForFacility, showToast]
  );

  const loginByFacility = useCallback(
    async (input: {
      facility_id?: string;
      facility_name?: string;
      access_mode?: 'facility_staff' | 'super_admin';
    }) => {
      const nextSession = await dbService.loginByFacility(input);
      setSession(nextSession);
      setActiveTabState('home');
      setNavigationIntent(null);
      await loadMasterDataForFacility(nextSession.active_facility_id);
      showToast(`تم الدخول إلى ${nextSession.active_facility_name}`, 'success');
    },
    [loadMasterDataForFacility, showToast]
  );

  const logout = useCallback(() => {
    dbService.logout();
    setSession(null);
    setMasterData(null);
    setActiveTabState('home');
    setNavigationIntent(null);
    showToast('تم تسجيل الخروج من البوابة الطبية.', 'info');
  }, [showToast]);

  const switchFacility = useCallback(
    async (facilityId: string) => {
      if (!session) return;
      if (session.user.role !== 'super_admin') {
        showToast('التبديل بين المراكز متاح للمشرف العام فقط.', 'error');
        return;
      }
      const target = session.facilities.find((f) => f.id === facilityId);
      if (!target || target.id === session.active_facility_id) return;

      dbService.setStoredActiveFacilityId(target.id);
      setSession({
        ...session,
        active_facility_id: target.id,
        active_facility_name: target.name,
      });
      setNavigationIntent(null);
      await loadMasterDataForFacility(target.id);
      showToast(`تم التبديل إلى: ${target.name}`, 'info');
    },
    [session, loadMasterDataForFacility, showToast]
  );

  const refreshFacilities = useCallback(async () => {
    if (!session) return;
    const list: Facility[] = await dbService.getFacilities();
    setSession((prev) => {
      if (!prev) return prev;
      const current = list.find((f) => f.id === prev.active_facility_id) || list[0];
      return {
        ...prev,
        facilities: list,
        active_facility_id: current?.id || prev.active_facility_id,
        active_facility_name: current?.name || prev.active_facility_name,
      };
    });
  }, [session]);

  const deleteFacility = useCallback(
    async (facilityId: string) => {
      if (!session) return;
      await dbService.deleteFacility(facilityId);
      const list: Facility[] = await dbService.getFacilities();
      if (list.length === 0) {
        dbService.logout();
        setSession(null);
        setMasterData(null);
        showToast('تم حذف المركز. لا توجد مراكز متبقية.', 'info');
        return;
      }
      const nextActive =
        facilityId === session.active_facility_id
          ? list[0]
          : list.find((f) => f.id === session.active_facility_id) || list[0];

      dbService.setStoredActiveFacilityId(nextActive.id);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              facilities: list,
              active_facility_id: nextActive.id,
              active_facility_name: nextActive.name,
            }
          : prev
      );
      if (facilityId === session.active_facility_id) {
        await loadMasterDataForFacility(nextActive.id);
      }
      showToast('تم حذف المركز الطبي وكافة بياناته بنجاح.', 'info');
    },
    [session, loadMasterDataForFacility, showToast]
  );

  const refreshMasterData = useCallback(
    async (force = false) => {
      if (!session) return;
      await loadMasterDataForFacility(session.active_facility_id, force);
    },
    [session, loadMasterDataForFacility]
  );

  const setActiveTab = useCallback((tab: PortalTab) => {
    setNavigationIntent(null);
    setActiveTabState(tab);
  }, []);

  const navigateWithFilter = useCallback((intent: NavigationFilterIntent) => {
    setNavigationIntent(intent);
    setActiveTabState(intent.tab);
  }, []);

  const clearNavigationIntent = useCallback(() => {
    setNavigationIntent(null);
  }, []);

  const saveLeaders = useCallback(
    async (leaders: Omit<FacilityLeaders, 'id' | 'facility_id'>) => {
      if (!session) return;
      const updated = await dbService.updateLeaders(session.active_facility_id, leaders);
      setMasterData((prev) =>
        prev
          ? {
              ...prev,
              leaders: updated,
              settings: {
                ...prev.settings,
                hospital_director: updated.hospital_director,
                quality_director: updated.quality_director,
                ic_supervisor: updated.ic_supervisor,
                nursing_director: updated.nursing_director,
              },
            }
          : prev
      );
      showToast('تم تحديث بيانات قيادات المركز وتعميمها على كافة الموديولات.', 'success');
    },
    [session, showToast]
  );

  const addDepartment = useCallback(
    async (input: { name: string; type: FacilityDepartment['type'] }) => {
      if (!session) throw new Error('لا توجد جلسة نشطة');
      const created = await dbService.createDepartment(session.active_facility_id, input);
      setMasterData((prev) =>
        prev
          ? {
              ...prev,
              departments: [...prev.departments, created].sort((a, b) => a.name.localeCompare(b.name, 'ar')),
            }
          : prev
      );
      showToast(`تمت إضافة قسم "${created.name}" بنجاح.`, 'success');
      return created;
    },
    [session, showToast]
  );

  const editDepartment = useCallback(
    async (id: string, input: Partial<Pick<FacilityDepartment, 'name' | 'type'>>) => {
      if (!session) throw new Error('لا توجد جلسة نشطة');
      const updated = await dbService.updateDepartment(session.active_facility_id, id, input);
      setMasterData((prev) =>
        prev
          ? {
              ...prev,
              departments: prev.departments.map((d) => (d.id === id ? updated : d)),
            }
          : prev
      );
      showToast('تم تحديث بيانات القسم.', 'success');
      return updated;
    },
    [session, showToast]
  );

  const removeDepartment = useCallback(
    async (id: string) => {
      if (!session) return;
      await dbService.deleteDepartment(session.active_facility_id, id);
      setMasterData((prev) =>
        prev
          ? {
              ...prev,
              departments: prev.departments.filter((d) => d.id !== id),
              staff: prev.staff.filter((s) => s.department_id !== id),
            }
          : prev
      );
      showToast('تم حذف القسم من هيكل المركز.', 'info');
    },
    [session, showToast]
  );

  const addStaff = useCallback(
    async (input: Omit<FacilityStaffMember, 'id' | 'facility_id'>) => {
      if (!session) throw new Error('لا توجد جلسة نشطة');
      const created = await dbService.createStaff(session.active_facility_id, input);
      setMasterData((prev) =>
        prev
          ? {
              ...prev,
              staff: [...prev.staff, created].sort((a, b) => a.name.localeCompare(b.name, 'ar')),
            }
          : prev
      );
      showToast(`تم تسجيل الموظف "${created.name}" في السجل الموحد.`, 'success');
      return created;
    },
    [session, showToast]
  );

  const editStaff = useCallback(
    async (id: string, input: Partial<Omit<FacilityStaffMember, 'id' | 'facility_id'>>) => {
      if (!session) throw new Error('لا توجد جلسة نشطة');
      const updated = await dbService.updateStaff(session.active_facility_id, id, input);
      setMasterData((prev) =>
        prev
          ? {
              ...prev,
              staff: prev.staff.map((s) => (s.id === id ? updated : s)),
            }
          : prev
      );
      showToast('تم تحديث بيانات الموظف.', 'success');
      return updated;
    },
    [session, showToast]
  );

  const removeStaff = useCallback(
    async (id: string) => {
      if (!session) return;
      await dbService.deleteStaff(session.active_facility_id, id);
      setMasterData((prev) =>
        prev ? { ...prev, staff: prev.staff.filter((s) => s.id !== id) } : prev
      );
      showToast('تم حذف الموظف من سجل المركز.', 'info');
    },
    [session, showToast]
  );

  return (
    <FacilityContext.Provider
      value={{
        session,
        authChecking,
        masterData,
        masterLoading,
        activeTab,
        navigationIntent,
        setActiveTab,
        navigateWithFilter,
        clearNavigationIntent,
        login,
        loginByFacility,
        logout,
        switchFacility,
        deleteFacility,
        refreshFacilities,
        refreshMasterData,
        saveLeaders,
        addDepartment,
        editDepartment,
        removeDepartment,
        addStaff,
        editStaff,
        removeStaff,
      }}
    >
      {children}
    </FacilityContext.Provider>
  );
};

export function useFacility(): FacilityContextValue {
  const ctx = useContext(FacilityContext);
  if (!ctx) throw new Error('useFacility must be used within FacilityProvider');
  return ctx;
}
