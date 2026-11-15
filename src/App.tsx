import React from 'react';
import { ClipboardCheck, Droplets, GraduationCap } from 'lucide-react';

interface PortalAppItem {
  id: string;
  indexLabel: string;
  categoryLabel: string;
  title: string;
  description: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PORTAL_APPS: PortalAppItem[] = [
  {
    id: 'ipc-reports',
    indexLabel: '01',
    categoryLabel: 'المتابعة الميدانية',
    title: 'تقارير المرور',
    description:
      'تسجيل ومتابعة جولات المرور الدورية على الأقسام، ورصد الملاحظات والتوصيات التصحيحية.',
    url: 'https://ipc-reports.vercel.app/',
    icon: ClipboardCheck,
  },
  {
    id: 'ipc-training',
    indexLabel: '02',
    categoryLabel: 'التدريب والتأهيل',
    title: 'البرنامج التدريبي',
    description:
      'إدارة الخطط التدريبية الشهرية، وتسجيل حضور العاملين والسياسات التدريبية المعتمدة.',
    url: 'https://ipc-training.vercel.app/',
    icon: GraduationCap,
  },
  {
    id: 'ipc-hhc',
    indexLabel: '03',
    categoryLabel: 'معايير منظمة الصحة العالمية',
    title: 'إحصائية غسيل الأيدي',
    description:
      'توثيق جلسات الملاحظة المباشرة للامتثال لغسيل الأيدي وحساب نسب الالتزام حسب الفئات.',
    url: 'https://ipc-hhc.vercel.app/',
    icon: Droplets,
  },
];

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 rounded"
          >
            منظومة مكافحة العدوى
          </a>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
        <section className="pb-8 border-b border-slate-200/80">
          <div className="space-y-3 max-w-2xl">
            <h1 className="font-display text-2xl sm:text-4xl font-bold text-slate-900 leading-tight">
              بوابة تطبيقات مكافحة العدوى
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              اختر التطبيق المطلوب للانتقال مباشرة إلى نظام تقارير المرور، أو البرنامج التدريبي، أو
              إحصائية غسيل الأيدي.
            </p>
          </div>
        </section>

        <section
          aria-label="قائمة التطبيقات"
          className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {PORTAL_APPS.map((app) => {
            const Icon = app.icon;

            return (
              <a
                key={app.id}
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between transition-all duration-200 hover:border-teal-600/60 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
              >
                <div>
                  <div className="w-11 h-11 rounded-lg bg-teal-50 border border-teal-100 text-teal-700 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </div>

                  <div className="mt-5 flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono-nums font-semibold text-teal-700">
                      {app.indexLabel}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{app.categoryLabel}</span>
                  </div>

                  <h2 className="mt-2 font-display text-xl font-bold text-slate-900 group-hover:text-teal-700 transition-colors">
                    {app.title}
                  </h2>

                  <p className="mt-2.5 text-sm text-slate-600 leading-relaxed">
                    {app.description}
                  </p>
                </div>
              </a>
            );
          })}
        </section>
      </main>

      <footer className="border-t border-slate-200/80 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between text-xs text-slate-500">
          <span>منظومة مكافحة العدوى — البوابة الموحدة للتطبيقات</span>
        </div>
      </footer>
    </div>
  );
}
