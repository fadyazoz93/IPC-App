import React, { useEffect, useMemo, useState } from 'react';
import { useFacility } from '../context/FacilityContext';
import { useToast } from '../context/ToastContext';
import { dbService } from '../services/dbService';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import { Reports, type ReportPersistenceHandlers, type SettingsData } from './Reports';

export const ModuleOneView: React.FC = () => {
  const { session } = useFacility();
  const { showToast } = useToast();

  const facilityId = session?.active_facility_id || '';
  const [m1Settings, setM1Settings] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!facilityId) return;
    let active = true;
    setLoading(true);
    dbService
      .getModuleOneSettings(facilityId)
      .then((loaded) => {
        if (active) setM1Settings(loaded);
      })
      .catch((err) => {
        if (active) {
          showToast(
            err instanceof Error ? err.message : 'تعذر تحميل إعدادات تقارير المرور.',
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

  const unifiedHospitalName = activeFacility?.name || session?.active_facility_name || '';
  const unifiedRightLogo = activeFacility?.right_logo_url ?? m1Settings?.rightLogoUrl ?? '';
  const unifiedLeftLogo = activeFacility?.left_logo_url ?? m1Settings?.leftLogoUrl ?? '';

  const effectiveSettings = useMemo<SettingsData | null>(
    () =>
      m1Settings
        ? {
            ...m1Settings,
            hospitalName: unifiedHospitalName || m1Settings.hospitalName,
            rightLogoUrl: unifiedRightLogo,
            leftLogoUrl: unifiedLeftLogo,
          }
        : null,
    [m1Settings, unifiedHospitalName, unifiedRightLogo, unifiedLeftLogo]
  );

  const reportSession = useMemo(
    () =>
      session
        ? {
            hospitalName: unifiedHospitalName || session.active_facility_name,
            userName:
              m1Settings?.inspectors?.[0] ||
              session.user?.name ||
              unifiedHospitalName ||
              session.active_facility_name,
            userRole: session.user?.role || 'super_admin',
            teamSignature: m1Settings?.teamSignature || 'مشرف مكافحة العدوى',
            managerSignature: m1Settings?.managerSignature || 'مدير عام المستشفى',
            rightLogoUrl: unifiedRightLogo,
            leftLogoUrl: unifiedLeftLogo,
          }
        : null,
    [session, m1Settings, unifiedHospitalName, unifiedRightLogo, unifiedLeftLogo]
  );

  const handlers = useMemo<ReportPersistenceHandlers>(
    () => ({
      loadSettings: async () => {
        const fresh = await dbService.getModuleOneSettings(facilityId, true);
        setM1Settings(fresh);
        return {
          ...fresh,
          hospitalName: activeFacility?.name || session?.active_facility_name || fresh.hospitalName,
          rightLogoUrl: activeFacility?.right_logo_url ?? fresh.rightLogoUrl ?? '',
          leftLogoUrl: activeFacility?.left_logo_url ?? fresh.leftLogoUrl ?? '',
        };
      },
      saveSettings: async (next) => {
        const saved = await dbService.saveModuleOneSettings(facilityId, {
          ...next,
          hospitalName: unifiedHospitalName || next.hospitalName,
          rightLogoUrl: unifiedRightLogo,
          leftLogoUrl: unifiedLeftLogo,
        });
        setM1Settings(saved);
        showToast('تم حفظ إعدادات تقارير المرور لهذا المركز بنجاح.', 'success');
      },
      saveWeeklyReport: async (report) => {
        await dbService.saveWeeklyReport(facilityId, report);
        showToast('تم حفظ تقرير المرور الأسبوعي بنجاح.', 'success');
      },
      updateWeeklyReport: async (recordId, report) => {
        await dbService.updateWeeklyReport(facilityId, recordId, report);
        showToast('تم تعديل تقرير المرور بنجاح.', 'success');
      },
      deleteWeeklyReports: async (recordIds) => {
        await dbService.deleteWeeklyReports(facilityId, recordIds);
        showToast('تم حذف التقرير من الأرشيف بنجاح.', 'info');
      },
      fetchReportRows: (type, params) => dbService.fetchReportRows(facilityId, type, params),
      copyMonthlyReport: async (sourceMonth, targetMonth, replaceExisting) => {
        const res = await dbService.copyMonthlyReport(
          facilityId,
          sourceMonth,
          targetMonth,
          replaceExisting
        );
        showToast(res.message || 'تم نسخ التقرير الشهري بنجاح.', 'success');
        return res;
      },
      fetchCacheMetrics: () => dbService.getReportCacheMetrics(),
    }),
    [facilityId, showToast, activeFacility, session, unifiedHospitalName, unifiedRightLogo, unifiedLeftLogo]
  );

  if (!session || !facilityId) return null;

  if (loading || !effectiveSettings) {
    return <TableSkeleton rows={6} columns={5} />;
  }

  return (
    <Reports
      key={facilityId}
      session={reportSession}
      initialSettings={effectiveSettings}
      handlers={handlers}
    />
  );
};
