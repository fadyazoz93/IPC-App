import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LoginGate } from './components/LoginGate';
import { MigrationToolView } from './components/MigrationToolView';
import { ModulesHomeView } from './components/ModulesHomeView';
import { PortalLayout } from './components/PortalLayout';
import { FacilityProvider, useFacility } from './context/FacilityContext';
import { ToastProvider } from './context/ToastContext';
import { ModuleOneView } from './modules/ModuleOneView';
import { ModuleThreeView } from './modules/ModuleThreeView';
import { ModuleTwoView } from './modules/ModuleTwoView';

const PortalRouter: React.FC = () => {
  const { session, authChecking, activeTab } = useFacility();

  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-teal-700 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-600">جاري تحميل البوابة الطبية...</p>
        </div>
      </div>
    );
  }

  if (!session || !session.user) {
    return <LoginGate />;
  }

  return (
    <PortalLayout>
      <AnimatePresence mode="wait">
        <motion.div
          key={`${session.active_facility_id}-${activeTab}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16 }}
        >
          {activeTab === 'home' && <ModulesHomeView />}
          {activeTab === 'module_one' && <ModuleOneView />}
          {activeTab === 'module_two' && <ModuleTwoView />}
          {activeTab === 'module_three' && <ModuleThreeView />}
          {activeTab === 'migration' && <MigrationToolView />}
        </motion.div>
      </AnimatePresence>
    </PortalLayout>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <FacilityProvider>
        <PortalRouter />
      </FacilityProvider>
    </ToastProvider>
  );
}
