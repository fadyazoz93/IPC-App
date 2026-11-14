import React, { useState } from 'react';
import {
  Activity,
  Building2,
  ClipboardCheck,
  Droplets,
  FileUp,
  GraduationCap,
  LayoutGrid,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useFacility } from '../context/FacilityContext';
import { PortalTab } from '../types/portal';

interface NavItem {
  id: PortalTab;
  label: string;
  icon: React.FC<{ className?: string }>;
  superAdminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'الرئيسية', icon: LayoutGrid },
  { id: 'module_one', label: 'تقارير المرور', icon: ClipboardCheck },
  { id: 'module_two', label: 'البرنامج التدريبي', icon: GraduationCap },
  { id: 'module_three', label: 'إحصائية غسيل الأيدي', icon: Droplets },
  { id: 'migration', label: 'أداة ترحيل البيانات', icon: FileUp, superAdminOnly: true },
];

export const PortalLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, activeTab, setActiveTab, logout } = useFacility();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!session || !session.user) return null;

  const isSuperAdmin = session.user?.role === 'super_admin';
  const visibleNav = NAV_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin);
  const currentTitle = visibleNav.find((n) => n.id === activeTab)?.label || 'الرئيسية';

  const handleSelectNav = (tab: PortalTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex overflow-x-clip">
      {/* Desktop Fixed Sidebar (RTL right side) */}
      <aside className="no-print hidden lg:flex lg:w-64 xl:w-72 lg:flex-col lg:fixed lg:inset-y-0 lg:right-0 bg-white border-l border-slate-200 z-30">
        <div className="h-16 flex items-center gap-3 px-5 xl:px-6 border-b border-slate-200 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-teal-700 text-white flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <span className="block text-sm font-bold text-slate-900 truncate">البوابة الطبية الموحدة</span>
            <span className="block text-xs text-slate-500 truncate">منظومة إدارة المراكز</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-1" aria-label="التنقل الرئيسي">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-teal-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 p-4 space-y-3 bg-slate-50/70">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{session.active_facility_name}</p>
            <p className="text-xs text-slate-500 truncate mt-0.5">المركز الطبي النشط</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-rose-700 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white h-full border-l border-slate-200 flex flex-col">
            <div className="h-14 flex items-center justify-between px-4 border-b border-slate-200 shrink-0">
              <span className="text-sm font-bold text-slate-900 truncate">البوابة الطبية الموحدة</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                aria-label="إغلاق القائمة"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70">
              <p className="text-xs text-slate-500">المركز النشط</p>
              <p className="text-sm font-bold text-slate-900 truncate mt-0.5">{session.active_facility_name}</p>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNav(item.id)}
                    className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive ? 'bg-teal-700 text-white' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="border-t border-slate-200 p-4">
              <button
                type="button"
                onClick={logout}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pr-64 xl:pr-72 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="no-print sticky top-0 z-20 h-14 sm:h-16 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 shrink-0"
              aria-label="فتح القائمة الجانبية"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs sm:text-sm min-w-0">
              <Building2 className="w-4 h-4 text-teal-700 shrink-0" />
              <span className="font-bold text-slate-900 truncate">{session.active_facility_name}</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="text-slate-600 truncate hidden sm:inline">{currentTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              type="button"
              onClick={logout}
              className="min-h-[40px] inline-flex items-center gap-1.5 sm:gap-2 rounded-lg border border-slate-300 bg-white px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-rose-700 transition-colors cursor-pointer whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>تغيير المركز</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-2.5 sm:p-5 lg:p-8 max-w-[1440px] w-full mx-auto min-w-0">{children}</main>
      </div>
    </div>
  );
};
