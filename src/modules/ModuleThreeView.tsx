import React, { useEffect, useMemo, useState } from 'react';
import { useFacility } from '../context/FacilityContext';
import { useToast } from '../context/ToastContext';
import { dbService } from '../services/dbService';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import {
  Compliance,
  type AppSettings,
  type ComplianceHandlers,
  type SessionDataRecord,
} from './Compliance';

export const ModuleThreeView: React.FC = () => {
  const { session } = useFacility();
  const { showToast } = useToast();

  const facilityId = session?.active_facility_id || '';
  const [sessions, setSessions] = useState<SessionDataRecord[] | null>(null);
  const [hhSettings, setHhSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!facilityId) return;
    let active = true;
    setLoading(true);
    Promise.all([
      dbService.getHandHygieneSessions(facilityId),
      dbService.getModuleThreeSettings(facilityId),
    ])
      .then(([loadedSessions, loadedSettings]) => {
        if (active) {
          setSessions(loadedSessions);
          setHhSettings(loadedSettings);
        }
      })
      .catch((err) => {
        if (active) {
          showToast(
            err instanceof Error ? err.message : 'تعذر تحميل بيانات إحصائية غسيل الأيدي.',
            'error'
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [facilityId, showToast]);

  const activeFacility = useMemo(
    () => session?.facilities?.find((f) => f.id === facilityId),
    [session, facilityId]
  );

  const unifiedFacilityName = activeFacility?.name || session?.active_facility_name || '';
  const unifiedRightLogo = activeFacility?.right_logo_url ?? hhSettings?.logoRight ?? '';
  const unifiedLeftLogo = activeFacility?.left_logo_url ?? hhSettings?.logoLeft ?? '';

  const handlers = useMemo<ComplianceHandlers>(
    () => ({
      loadObservations: async () => {
        const refreshed = await dbService.getHandHygieneSessions(facilityId, true);
        setSessions(refreshed);
        return refreshed;
      },
      saveSession: async (payload) => {
        const res = await dbService.saveHandHygieneSession(facilityId, payload);
        showToast('تم حفظ جلسة رصد غسيل الأيدي بنجاح.', 'success');
        return res;
      },
      deleteSession: async (sessionId) => {
        const res = await dbService.deleteHandHygieneSession(facilityId, sessionId);
        showToast('تم حذف جلسة الرصد.', 'success');
        return res;
      },
      deleteMonths: async (monthKeys) => {
        const res = await dbService.deleteHandHygieneMonths(facilityId, monthKeys);
        showToast('تم حذف سجلات الأشهر المحددة.', 'success');
        return res;
      },
      updateSessionDate: async (payload) => {
        const res = await dbService.updateHandHygieneSessionDate(facilityId, payload);
        showToast('تم تحديث تاريخ الجلسة بنجاح.', 'success');
        return res;
      },
      updateSessionDepartment: async (payload) => {
        const res = await dbService.updateHandHygieneSessionDepartment(facilityId, payload);
        showToast('تم تحديث قسم الجلسة بنجاح.', 'success');
        return res;
      },
      loadSettings: async () => {
        const fresh = await dbService.getModuleThreeSettings(facilityId, true);
        setHhSettings(fresh);
        return {
          ...fresh,
          header1: unifiedFacilityName || fresh.header1,
          facilities: unifiedFacilityName ? [unifiedFacilityName] : fresh.facilities,
          logoRight: activeFacility?.right_logo_url ?? fresh.logoRight ?? '',
          logoLeft: activeFacility?.left_logo_url ?? fresh.logoLeft ?? '',
        };
      },
      saveSettings: async (nextSettings) => {
        const saved = await dbService.saveModuleThreeSettings(facilityId, {
          ...nextSettings,
          header1: unifiedFacilityName || nextSettings.header1,
          facilities: unifiedFacilityName ? [unifiedFacilityName] : nextSettings.facilities,
          logoRight: unifiedRightLogo,
          logoLeft: unifiedLeftLogo,
        });
        setHhSettings(saved);
        showToast('تم حفظ إعدادات إحصائية غسيل الأيدي لهذا المركز بنجاح.', 'success');
        return { success: true, settings: saved };
      },
    }),
    [facilityId, showToast, activeFacility, unifiedFacilityName, unifiedRightLogo, unifiedLeftLogo]
  );

  const effectiveSettings = useMemo<AppSettings | null>(
    () =>
      hhSettings
        ? {
            ...hhSettings,
            header1: unifiedFacilityName || hhSettings.header1,
            facilities: unifiedFacilityName ? [unifiedFacilityName] : hhSettings.facilities,
            logoRight: unifiedRightLogo,
            logoLeft: unifiedLeftLogo,
          }
        : null,
    [hhSettings, unifiedFacilityName, unifiedRightLogo, unifiedLeftLogo]
  );

  if (!session || !facilityId) return null;

  if (loading || sessions === null || !effectiveSettings) {
    return <TableSkeleton rows={6} columns={5} />;
  }

  return (
    <Compliance
      key={facilityId}
      sessions={sessions}
      settings={effectiveSettings}
      defaultCountry="Egypt"
      canAccessSettings={true}
      handlers={handlers}
      onSessionsChange={setSessions}
    />
  );
};
