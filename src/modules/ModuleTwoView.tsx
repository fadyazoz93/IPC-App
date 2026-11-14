import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFacility } from '../context/FacilityContext';
import { useToast } from '../context/ToastContext';
import { dbService } from '../services/dbService';
import { TableSkeleton } from '../components/ui/TableSkeleton';
import {
  localTrainingMutations,
  Training,
  type TrainingData,
  type TrainingPersistenceHandlers,
} from './Training';

export const ModuleTwoView: React.FC = () => {
  const { session } = useFacility();
  const { showToast } = useToast();

  const facilityId = session?.active_facility_id || '';
  const [trainingData, setTrainingData] = useState<TrainingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!facilityId) return;
    let active = true;
    setLoading(true);
    dbService
      .getTrainingData(facilityId)
      .then((data) => {
        if (active) setTrainingData(data);
      })
      .catch((err) => {
        if (active) {
          showToast(
            err instanceof Error ? err.message : 'تعذر تحميل بيانات البرنامج التدريبي.',
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

  const persistMutation = useCallback(
    async (next: TrainingData): Promise<TrainingData> => {
      const previous = trainingData;
      // Optimistic local state update first without waiting for DB refetch
      setTrainingData(next);
      try {
        const saved = await dbService.saveTrainingData(facilityId, next);
        setTrainingData(saved);
        return saved;
      } catch (err) {
        if (previous) setTrainingData(previous);
        showToast(
          err instanceof Error ? err.message : 'تعذر حفظ تعديلات البرنامج التدريبي.',
          'error'
        );
        throw err;
      }
    },
    [facilityId, showToast, trainingData]
  );

  const handlers = useMemo<TrainingPersistenceHandlers>(
    () => ({
      onSaveTrainingSession: (payload, current) =>
        persistMutation(localTrainingMutations.saveTrainingSession(current, payload)),
      onAddTraineesToSession: (payload, current) =>
        persistMutation(localTrainingMutations.addTraineesToSession(current, payload)),
      onUpdateSessionTrainer: (payload, current) =>
        persistMutation(localTrainingMutations.updateSessionTrainer(current, payload)),
      onUpdateSessionPolicies: (payload, current) =>
        persistMutation(localTrainingMutations.updateSessionPolicies(current, payload)),
      onDeleteTrainingSession: (payload, current) =>
        persistMutation(localTrainingMutations.deleteTrainingSession(current, payload)),
      onSavePlan: (payload, current) =>
        persistMutation(localTrainingMutations.savePlan(current, payload)),
      onSavePlanBatch: (items, current) =>
        persistMutation(localTrainingMutations.savePlanBatch(current, items)),
      onUpdateEmployeesBulk: (employees, current) =>
        persistMutation(localTrainingMutations.updateEmployeesBulk(current, employees)),
      onDeleteEmployee: (payload, current) =>
        persistMutation(localTrainingMutations.deleteEmployee(current, payload)),
      onSaveSettingsItem: (payload, current) =>
        persistMutation(localTrainingMutations.saveSettingsItem(current, payload)),
      onDeleteSettingsItem: (payload, current) =>
        persistMutation(localTrainingMutations.deleteSettingsItem(current, payload)),
      onRenamePolicy: (payload, current) =>
        persistMutation(localTrainingMutations.renamePolicy(current, payload)),
      onRefreshAllData: async () => {
        const refreshed = await dbService.getTrainingData(facilityId, true);
        setTrainingData(refreshed);
        return refreshed;
      },
    }),
    [facilityId, persistMutation]
  );

  const activeFacility = useMemo(
    () => session?.facilities?.find((f) => f.id === facilityId),
    [session, facilityId]
  );

  if (!session || !facilityId) return null;

  if (loading || !trainingData) {
    return <TableSkeleton rows={6} columns={5} />;
  }

  return (
    <Training
      key={facilityId}
      logs={trainingData.logs}
      employees={trainingData.employees}
      categories={trainingData.categories}
      plan={trainingData.plan}
      settings={trainingData.settings}
      hospitalName={activeFacility?.name || session.active_facility_name}
      hospitalLogo={activeFacility?.right_logo_url ?? ''}
      hospitalLogoLeft={activeFacility?.left_logo_url ?? ''}
      handlers={handlers}
      onDataChange={setTrainingData}
    />
  );
};
