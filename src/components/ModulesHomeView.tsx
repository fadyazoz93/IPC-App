import React from 'react';
import {
  ArrowLeft,
  Building2,
  ClipboardCheck,
  Droplets,
  FileUp,
  GraduationCap,
} from 'lucide-react';
import { useFacility } from '../context/FacilityContext';
import { PortalTab } from '../types/portal';

interface ModuleCardConfig {
  id: PortalTab;
  title: string;
  description: string;
  highlights: string[];
  actionLabel: string;
  icon: React.FC<{ className?: string }>;
  accentBg: string;
  accentText: string;
  accentBorder: string;
  hoverBorder: string;
  superAdminOnly?: boolean;
}

const MODULE_CARDS: ModuleCardConfig[] = [
  {
    id: 'module_one',
    title: 'تقارير المرور',
    description:
      'إدارة جولات المرور اليومية والأسبوعية والشهرية، متابعة الملاحظات والإجراءات التصحيحية، وتخصيص إعدادات الترويسة والأقسام.',
    highlights: ['المرور اليومي والأسبوعي', 'التقارير المجمعة والطباعة', 'إعدادات المرور الخاصة بالمركز'],
    actionLabel: 'فتح تقارير المرور',
    icon: ClipboardCheck,
    accentBg: 'bg-teal-50',
    accentText: 'text-teal-700',
    accentBorder: 'border-teal-100',
    hoverBorder: 'hover:border-teal-500',
  },
  {
    id: 'module_two',
    title: 'البرنامج التدريبي',
    description:
      'متابعة الخطة التدريبية السنوية، تسجيل حضور المتدربين، استعراض مؤشرات التدريب، وإدارة السياسات والمدربين والفئات.',
    highlights: ['سجل التدريب والحضور', 'متابعة الخطة التدريبية', 'إعدادات التدريب الخاصة بالمركز'],
    actionLabel: 'فتح البرنامج التدريبي',
    icon: GraduationCap,
    accentBg: 'bg-indigo-50',
    accentText: 'text-indigo-700',
    accentBorder: 'border-indigo-100',
    hoverBorder: 'hover:border-indigo-500',
  },
  {
    id: 'module_three',
    title: 'إحصائية غسيل الأيدي',
    description:
      'رصد فرص ونسب الالتزام بغسيل الأيدي وفق معايير منظمة الصحة العالمية، وتحليل النتائج حسب الأقسام والفئات وإعدادات الرصد.',
    highlights: ['نموذج الرصد الميداني', 'التقارير والإحصائيات الشهرية', 'إعدادات الرصد الخاصة بالمركز'],
    actionLabel: 'فتح إحصائية غسيل الأيدي',
    icon: Droplets,
    accentBg: 'bg-sky-50',
    accentText: 'text-sky-700',
    accentBorder: 'border-sky-100',
    hoverBorder: 'hover:border-sky-500',
  },
  {
    id: 'migration',
    title: 'أداة ترحيل البيانات',
    description:
      'استيراد وترحيل قواعد البيانات السابقة (SQLite / JSON) وربط جداول السجلات والإعدادات مباشرة بالمركز الطبي المستهدف.',
    highlights: ['فحص ملفات .db و JSON', 'مطابقة الجداول والإعدادات', 'ترحيل آمن بدون تكرار'],
    actionLabel: 'فتح أداة الترحيل',
    icon: FileUp,
    accentBg: 'bg-amber-50',
    accentText: 'text-amber-700',
    accentBorder: 'border-amber-100',
    hoverBorder: 'hover:border-amber-500',
    superAdminOnly: true,
  },
];

export const ModulesHomeView: React.FC = () => {
  const { session, setActiveTab } = useFacility();

  if (!session) return null;

  const isSuperAdmin = session.user?.role === 'super_admin';
  const visibleCards = MODULE_CARDS.filter((card) => !card.superAdminOnly || isSuperAdmin);

  return (
    <div className="space-y-5 sm:space-y-8">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 lg:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-3 py-1">
              <Building2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{session.active_facility_name}</span>
            </div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900">
              الأنظمة والتطبيقات التشغيلية
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 max-w-2xl leading-relaxed">
              اختر التطبيق المطلوب من البطاقات التالية للانتقال المباشر وإدارة السجلات والتقارير والإعدادات الخاصة بهذا المركز.
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Cards Grid */}
      <div
        className={`grid grid-cols-1 md:grid-cols-2 ${
          visibleCards.length >= 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3'
        } gap-4 sm:gap-5`}
      >
        {visibleCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => setActiveTab(card.id)}
              className={`group text-right rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 transition-all duration-200 hover:shadow-md ${card.hoverBorder} flex flex-col justify-between cursor-pointer`}
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl border ${card.accentBg} ${card.accentBorder} ${card.accentText} flex items-center justify-center shrink-0`}
                  >
                    <Icon className="w-6 h-6" />
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-semibold ${card.accentText} opacity-80 group-hover:opacity-100 transition-opacity`}
                  >
                    <span>انتقال</span>
                    <ArrowLeft className="w-3.5 h-3.5 transition-transform group-hover:-translate-x-1" />
                  </span>
                </div>

                <h2 className="mt-5 text-lg font-bold text-slate-900 group-hover:text-teal-800 transition-colors">
                  {card.title}
                </h2>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{card.description}</p>

                <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-4">
                  {card.highlights.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-xs text-slate-600">
                      <span className={`w-1.5 h-1.5 rounded-full ${card.accentBg} ring-2 ring-current ${card.accentText} shrink-0`} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className={`text-sm font-bold ${card.accentText}`}>{card.actionLabel}</span>
                <span
                  className={`w-8 h-8 rounded-lg ${card.accentBg} ${card.accentText} flex items-center justify-center transition-transform group-hover:-translate-x-1`}
                >
                  <ArrowLeft className="w-4 h-4" />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
