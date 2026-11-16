import React, { useEffect, useState } from 'react';
import { ArrowUpLeft } from 'lucide-react';
import heroVisual from './assets/images/futuristic_light_medical_center_1794850624631.jpg';

type AppCardId = 'ipc-reports' | 'ipc-training' | 'ipc-hhc';

interface PortalAppItem {
  id: AppCardId;
  indexLabel: string;
  categoryLabel: string;
  title: string;
  description: string;
  url: string;
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
  },
  {
    id: 'ipc-training',
    indexLabel: '02',
    categoryLabel: 'التدريب والتأهيل',
    title: 'البرنامج التدريبي',
    description:
      'إدارة الخطط التدريبية الشهرية للكوادر الصحية، وتسجيل الحضور والسياسات التدريبية المعتمدة.',
    url: 'https://ipc-training.vercel.app/',
  },
  {
    id: 'ipc-hhc',
    indexLabel: '03',
    categoryLabel: 'معايير منظمة الصحة العالمية',
    title: 'إحصائية غسيل الأيدي',
    description:
      'توثيق جلسات الملاحظة المباشرة للامتثال لغسيل الأيدي وحساب نسب الالتزام حسب الفئات الطبية.',
    url: 'https://ipc-hhc.vercel.app/',
  },
];

function useAnimatedFavicon() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }

    let phase = 0;
    const drawFrame = () => {
      if (document.hidden) return;

      phase = (phase + 0.08) % (Math.PI * 2);
      const scanY = 20 + ((Math.sin(phase) + 1) / 2) * 24;
      const pulseAlpha = 0.45 + ((Math.cos(phase * 1.5) + 1) / 2) * 0.55;

      ctx.clearRect(0, 0, 64, 64);

      // Chamfered clinical light background
      ctx.beginPath();
      ctx.moveTo(2, 16);
      ctx.lineTo(16, 2);
      ctx.lineTo(62, 2);
      ctx.lineTo(62, 48);
      ctx.lineTo(48, 62);
      ctx.lineTo(2, 62);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, 0, 64, 64);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(1, '#E6F7F5');
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#0F766E';
      ctx.stroke();

      // Top calibration bar
      ctx.fillStyle = `rgba(13, 148, 136, ${pulseAlpha.toFixed(2)})`;
      ctx.fillRect(21, 2, 22, 3.5);

      // Shield path
      ctx.beginPath();
      ctx.moveTo(32, 13);
      ctx.lineTo(47, 19);
      ctx.lineTo(47, 33);
      ctx.bezierCurveTo(47, 42.2, 40.4, 49.4, 32, 52.5);
      ctx.bezierCurveTo(23.6, 49.4, 17, 42.2, 17, 33);
      ctx.lineTo(17, 19);
      ctx.closePath();
      ctx.fillStyle = '#F0FDFA';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#0F766E';
      ctx.stroke();

      // Crisp medical cross
      ctx.strokeStyle = '#0F766E';
      ctx.lineWidth = 4;
      ctx.lineCap = 'square';
      ctx.beginPath();
      ctx.moveTo(32, 23);
      ctx.lineTo(32, 39);
      ctx.moveTo(24, 31);
      ctx.lineTo(40, 31);
      ctx.stroke();

      // Animated scanner sweep inside shield
      ctx.strokeStyle = 'rgba(20, 184, 166, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(20, scanY);
      ctx.lineTo(44, scanY);
      ctx.stroke();

      link!.type = 'image/png';
      link!.href = canvas.toDataURL('image/png');
    };

    drawFrame();
    const intervalId = window.setInterval(drawFrame, 110);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);
}

function BrandAnimatedIcon() {
  return (
    <svg viewBox="0 0 28 28" className="w-5 h-5" fill="none" aria-hidden="true">
      <path
        d="M14 3L23 6.6V13.5C23 19.1 19.2 23.5 14 25.3C8.8 23.5 5 19.1 5 13.5V6.6L14 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14 9.5V17.5M10 13.5H18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="7.5"
        y1="13.5"
        x2="20.5"
        y2="13.5"
        stroke="#14B8A6"
        strokeWidth="1.4"
        className="animate-scan-beam"
      />
    </svg>
  );
}

function CardAnimatedIcon({ id }: { id: AppCardId }) {
  if (id === 'ipc-reports') {
    return (
      <svg viewBox="0 0 32 32" className="w-6 h-6" fill="none" aria-hidden="true">
        <rect
          x="7"
          y="6"
          width="18"
          height="21"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <path
          d="M12 6V4.5C12 3.67 12.67 3 13.5 3H18.5C19.33 3 20 3.67 20 4.5V6"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <path
          d="M11 16L13.5 16L15 12.5L17 19.5L18.5 15L20 16H21.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-pulse-line"
        />
        <line
          x1="9.5"
          y1="16"
          x2="22.5"
          y2="16"
          stroke="#14B8A6"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="animate-scan-beam"
        />
      </svg>
    );
  }

  if (id === 'ipc-training') {
    return (
      <svg viewBox="0 0 32 32" className="w-6 h-6" fill="none" aria-hidden="true">
        <circle
          cx="16"
          cy="16"
          r="12"
          stroke="#14B8A6"
          strokeWidth="1.3"
          strokeDasharray="4 3"
          className="animate-orbit-slow"
        />
        <g className="animate-droplet-float">
          <path
            d="M16 9.5L23.5 13L16 16.5L8.5 13L16 9.5Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <path
            d="M11.5 15V19.2C11.5 20.6 13.5 21.8 16 21.8C18.5 21.8 20.5 20.6 20.5 19.2V15"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 32 32" className="w-6 h-6" fill="none" aria-hidden="true">
      <circle
        cx="16"
        cy="18"
        r="7.5"
        stroke="#14B8A6"
        strokeWidth="1.4"
        className="animate-ripple-expand"
      />
      <path
        d="M16 6.5C16 6.5 10 13.6 10 18.2C10 21.5 12.7 24.2 16 24.2C19.3 24.2 22 21.5 22 18.2C22 13.6 16 6.5 16 6.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        className="animate-droplet-float"
      />
      <path
        d="M14 18.5C14 19.7 14.9 20.6 16 20.6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        className="animate-droplet-float"
      />
    </svg>
  );
}

export default function App() {
  const [heroImageError, setHeroImageError] = useState(false);
  useAnimatedFavicon();

  return (
    <div className="min-h-screen flex flex-col clinical-grid-bg text-slate-900">
      <header className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          <a
            href="/"
            className="inline-flex items-center gap-3 font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700"
          >
            <span className="p-px bg-teal-300/80 clinical-icon-chamfer shrink-0">
              <span className="w-9 h-9 bg-teal-50/90 clinical-icon-chamfer-inner text-teal-700 flex items-center justify-center">
                <BrandAnimatedIcon />
              </span>
            </span>
            <span>منظومة مكافحة العدوى</span>
          </a>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
        <section className="grid grid-cols-1 lg:grid-cols-12 items-stretch gap-8 pb-10 border-b border-slate-200/90">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-teal-700">
              <span>المراكز الطبية</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-slate-500">وحدة الجودة ومكافحة العدوى</span>
            </div>

            <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.65rem] font-bold text-slate-900 leading-[1.22]">
              البوابة الموحدة لتطبيقات مكافحة العدوى
            </h1>

            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl">
              منصة دخول مركزي للكوادر الطبية والإدارية للوصول المباشر إلى نظام تقارير المرور،
              والبرنامج التدريبي، وإحصائية غسيل الأيدي.
            </p>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-56 sm:h-64 lg:h-full lg:min-h-[250px] overflow-hidden rounded-xl border border-slate-200/90 bg-white">
              {!heroImageError ? (
                <img
                  src={heroVisual}
                  alt="مركز طبي مستقبلي مشرق لوحدة الجودة ومكافحة العدوى"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImageError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-white via-teal-50/60 to-slate-100 text-teal-700">
                  <BrandAnimatedIcon />
                </div>
              )}

              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-900/15 via-transparent to-transparent"
              />

              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-teal-600/60"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-teal-600/60"
              />
            </div>
          </div>
        </section>

        <section
          aria-label="قائمة التطبيقات"
          className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {PORTAL_APPS.map((app) => (
            <a
              key={app.id}
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block p-px bg-slate-300/85 clinical-card-chamfer transition-colors duration-200 hover:bg-teal-500/85 focus-visible:bg-teal-600 focus-visible:outline-none"
            >
              <div className="relative h-full bg-gradient-to-b from-white to-[#F7FAFC] clinical-card-chamfer-inner p-6 sm:p-7 flex flex-col justify-between transition-colors duration-200 group-hover:from-white group-hover:to-teal-50/45">
                {/* Top calibration bar */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-0 right-10 h-[2.5px] w-14 bg-teal-600/45 group-hover:bg-teal-600 transition-colors duration-200"
                />

                {/* Subtle geometric clinical schematic accent */}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 120 120"
                  className="pointer-events-none absolute top-3 left-3 w-24 h-24 text-teal-700/[0.06] group-hover:text-teal-600/[0.13] transition-colors duration-200"
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
                    <div className="p-px bg-teal-300/80 clinical-icon-chamfer group-hover:bg-teal-600 transition-colors duration-200 shrink-0">
                      <div className="w-12 h-12 bg-teal-50/90 clinical-icon-chamfer-inner text-teal-700 flex items-center justify-center group-hover:bg-teal-50 group-hover:text-teal-800 transition-colors duration-200">
                        <CardAnimatedIcon id={app.id} />
                      </div>
                    </div>

                    <div className="w-8 h-8 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 group-hover:border-teal-300 group-hover:bg-teal-50 group-hover:text-teal-700 transition-colors duration-200 shrink-0">
                      <ArrowUpLeft
                        className="w-4 h-4 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-200"
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  <div className="mt-7 flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono-nums font-semibold text-teal-700">
                      {app.indexLabel}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span>{app.categoryLabel}</span>
                  </div>

                  <h2 className="mt-2 font-display text-xl font-bold text-slate-900 group-hover:text-teal-700 transition-colors duration-200">
                    {app.title}
                  </h2>

                  <p className="mt-2.5 text-sm text-slate-600 leading-relaxed">
                    {app.description}
                  </p>
                </div>
              </div>
            </a>
          ))}
        </section>
      </main>

      <footer className="border-t border-slate-200/90 bg-white/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between text-xs text-slate-500">
          <span>منظومة مكافحة العدوى — البوابة الموحدة للمراكز الطبية</span>
        </div>
      </footer>
    </div>
  );
}
