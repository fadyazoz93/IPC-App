import React, { useState } from 'react';
import { ArrowUpLeft, ClipboardCheck, Droplets, GraduationCap, ShieldPlus } from 'lucide-react';
import heroVisual from './assets/images/futuristic_medical_center_hero_1794848840463.jpg';

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
      'تسجيل ومتابعة جولات المرور الدورية على الأقسام الطبية، ورصد الملاحظات والتوصيات التصحيحية.',
    url: 'https://ipc-reports.vercel.app/',
    icon: ClipboardCheck,
  },
  {
    id: 'ipc-training',
    indexLabel: '02',
    categoryLabel: 'التدريب والتأهيل',
    title: 'البرنامج التدريبي',
    description:
      'إدارة الخطط التدريبية الشهرية للكوادر الصحية، وتسجيل الحضور والسياسات التدريبية المعتمدة.',
    url: 'https://ipc-training.vercel.app/',
    icon: GraduationCap,
  },
  {
    id: 'ipc-hhc',
    indexLabel: '03',
    categoryLabel: 'معايير منظمة الصحة العالمية',
    title: 'إحصائية غسيل الأيدي',
    description:
      'توثيق جلسات الملاحظة المباشرة للامتثال لغسيل الأيدي وحساب نسب الالتزام حسب الفئات الطبية.',
    url: 'https://ipc-hhc.vercel.app/',
    icon: Droplets,
  },
];

export default function App() {
  const [heroImageError, setHeroImageError] = useState(false);

  return (
    <div className="min-h-screen flex flex-col clinical-grid-bg text-slate-100">
      <header className="sticky top-0 z-20 bg-[#060A11]/85 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            className="inline-flex items-center gap-3 font-display text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-400"
          >
            <span className="w-9 h-9 rounded-lg bg-[#0B1422] border border-teal-500/35 text-teal-400 flex items-center justify-center shrink-0">
              <ShieldPlus className="w-5 h-5" aria-hidden="true" />
            </span>
            <span>منظومة مكافحة العدوى</span>
          </a>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <section className="grid grid-cols-1 lg:grid-cols-12 items-stretch gap-8 pb-10 border-b border-slate-800/80">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-teal-400">
              <span>المراكز الطبية</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="text-slate-400">وحدة الجودة ومكافحة العدوى</span>
            </div>

            <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.65rem] font-bold text-slate-50 leading-[1.22]">
              البوابة الموحدة لتطبيقات مكافحة العدوى
            </h1>

            <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
              منصة دخول مركزي للكوادر الطبية والإدارية للوصول المباشر إلى نظام تقارير المرور،
              والبرنامج التدريبي، وإحصائية غسيل الأيدي.
            </p>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-56 sm:h-64 lg:h-full lg:min-h-[250px] overflow-hidden rounded-xl border border-slate-800 bg-[#0B121E]">
              {!heroImageError ? (
                <img
                  src={heroVisual}
                  alt="مركز القيادة الرقمي الحديث لمراقبة الجودة ومكافحة العدوى في المنشآت الطبية"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImageError(true)}
                  className="w-full h-full object-cover opacity-90"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#0B121E] via-[#0D1A2B] to-[#08101A]">
                  <ShieldPlus className="w-14 h-14 text-teal-400/70" aria-hidden="true" />
                </div>
              )}

              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#060A11]/75 via-[#060A11]/15 to-transparent"
              />

              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-3 right-3 w-4 h-4 border-t border-r border-teal-400/60"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-3 left-3 w-4 h-4 border-b border-l border-teal-400/60"
              />
            </div>
          </div>
        </section>

        <section
          aria-label="قائمة التطبيقات"
          className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {PORTAL_APPS.map((app) => {
            const Icon = app.icon;

            return (
              <a
                key={app.id}
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative block p-px bg-slate-800/90 clinical-card-chamfer transition-colors duration-200 hover:bg-teal-400/65 focus-visible:bg-teal-400 focus-visible:outline-none"
              >
                <div className="relative h-full bg-gradient-to-b from-[#0D1625] to-[#09101B] clinical-card-chamfer-inner p-6 sm:p-7 flex flex-col justify-between transition-colors duration-200 group-hover:from-[#101C2F] group-hover:to-[#0A1320]">
                  {/* Subtle top calibration bar integrated into card edge */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute top-0 right-10 h-[2px] w-14 bg-teal-500/45 group-hover:bg-teal-300 transition-colors duration-200"
                  />

                  {/* Subtle geometric clinical schematic accent in trailing corner */}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 120 120"
                    className="pointer-events-none absolute top-3 left-3 w-24 h-24 text-teal-400/[0.07] group-hover:text-teal-300/[0.14] transition-colors duration-200"
                    fill="none"
                  >
                    {app.id === 'ipc-reports' && (
                      <>
                        <rect x="24" y="20" width="72" height="72" stroke="currentColor" strokeWidth="1" />
                        <path d="M24 44H96M24 68H96M48 20V92M72 20V92" stroke="currentColor" strokeWidth="0.75" />
                        <path d="M32 62L46 62L53 46L62 74L70 54L77 62L88 62" stroke="currentColor" strokeWidth="1.5" />
                      </>
                    )}
                    {app.id === 'ipc-training' && (
                      <>
                        <polygon points="60,16 98,38 98,82 60,104 22,82 22,38" stroke="currentColor" strokeWidth="1" />
                        <polygon points="60,30 86,45 86,75 60,90 34,75 34,45" stroke="currentColor" strokeWidth="0.75" />
                        <circle cx="60" cy="60" r="10" stroke="currentColor" strokeWidth="1.2" />
                      </>
                    )}
                    {app.id === 'ipc-hhc' && (
                      <>
                        <circle cx="60" cy="60" r="38" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" />
                        <circle cx="60" cy="60" r="24" stroke="currentColor" strokeWidth="0.9" />
                        <path d="M60 32C60 32 45 50 45 61C45 69.3 51.7 76 60 76C68.3 76 75 69.3 75 61C75 50 60 32 60 32Z" stroke="currentColor" strokeWidth="1.3" />
                      </>
                    )}
                  </svg>

                  <div className="relative z-10">
                    <div className="flex items-center justify-between gap-4">
                      <div className="p-px bg-teal-500/35 clinical-icon-chamfer group-hover:bg-teal-400/80 transition-colors duration-200 shrink-0">
                        <div className="w-12 h-12 bg-[#070D17] clinical-icon-chamfer-inner text-teal-400 flex items-center justify-center group-hover:text-teal-300 transition-colors duration-200">
                          <Icon className="w-5 h-5" aria-hidden="true" />
                        </div>
                      </div>

                      <div className="w-8 h-8 rounded-md border border-slate-800/90 bg-[#070D17]/80 flex items-center justify-center text-slate-400 group-hover:border-teal-500/45 group-hover:text-teal-300 transition-colors duration-200 shrink-0">
                        <ArrowUpLeft
                          className="w-4 h-4 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-200"
                          aria-hidden="true"
                        />
                      </div>
                    </div>

                    <div className="mt-7 flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono-nums font-semibold text-teal-400">
                        {app.indexLabel}
                      </span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>{app.categoryLabel}</span>
                    </div>

                    <h2 className="mt-2 font-display text-xl font-bold text-slate-50 group-hover:text-teal-300 transition-colors duration-200">
                      {app.title}
                    </h2>

                    <p className="mt-2.5 text-sm text-slate-300/90 leading-relaxed">
                      {app.description}
                    </p>
                  </div>
                </div>
              </a>
            );
          })}
        </section>
      </main>

      <footer className="border-t border-slate-800/80 bg-[#060A11]/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between text-xs text-slate-400">
          <span>منظومة مكافحة العدوى — البوابة الموحدة للمراكز الطبية</span>
        </div>
      </footer>
    </div>
  );
}
