import React, { useEffect, useState } from 'react';
import { ArrowUpLeft } from 'lucide-react';
import heroVisual from './assets/images/futuristic_light_medical_center_1794850624631.jpg';

type AppCardId =
  | 'ipc-reports'
  | 'ipc-training'
  | 'ipc-hhc'
  | 'ipc-competency'
  | 'mms-reports'
  | 'mms-training';

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
    title: 'تقارير مرور مكافحة العدوى',
    description:
      'تسجيل ومتابعة جولات المرور الدورية على الأقسام الطبية، ورصد الملاحظات والتوصيات التصحيحية.',
    url: 'https://ipc-reports.vercel.app/',
  },
  {
    id: 'ipc-training',
    indexLabel: '02',
    categoryLabel: 'التدريب والتأهيل',
    title: 'البرنامج التدريبي لمكافحة العدوى',
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
  {
    id: 'ipc-competency',
    indexLabel: '04',
    categoryLabel: 'تقييم الكفاءة المهنية',
    title: 'Competency Assessment',
    description:
      'تقييم وقياس الكفاءة العملية للكوادر الصحية في تطبيق سياسات وإجراءات مكافحة العدوى المعتمدة.',
    url: 'https://ipc-competency.vercel.app/',
  },
  {
    id: 'mms-reports',
    indexLabel: '05',
    categoryLabel: 'إدارة وسلامة الدواء',
    title: 'تقارير مرور إدارة وسلامة الدواء',
    description:
      'متابعة جولات التفتيش والمرور الدوري على الصيدليات ومخازن الأدوية، ورصد ملاحظات سلامة الدواء.',
    url: 'https://mms-reports.vercel.app/',
  },
  {
    id: 'mms-training',
    indexLabel: '06',
    categoryLabel: 'التدريب · سلامة الدواء',
    title: 'البرنامج التدريبي لإدارة وسلامة الدواء',
    description:
      'تنظيم البرامج والخطط التدريبية للكوادر الصحية في سياسات الصرف الآمن والتعامل مع الأدوية.',
    url: 'https://mms-training.vercel.app/',
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

      phase = (phase + 0.14) % (Math.PI * 2);
      const scanProgress = (Math.sin(phase) + 1) / 2;
      const scanY = 6 + scanProgress * 52;
      const pulse = (Math.cos(phase) + 1) / 2;

      ctx.clearRect(0, 0, 64, 64);

      // Full-bleed bold chamfered chassis so favicon reads large at 16x16
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(2, 14);
      ctx.lineTo(14, 2);
      ctx.lineTo(62, 2);
      ctx.lineTo(62, 50);
      ctx.lineTo(50, 62);
      ctx.lineTo(2, 62);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, 0, 64, 64);
      grad.addColorStop(0, pulse > 0.5 ? '#0F766E' : '#115E59');
      grad.addColorStop(1, '#0D9488');
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.lineWidth = 3;
      ctx.strokeStyle = '#042F2E';
      ctx.stroke();

      // Clip scanner sweep inside the full-bleed chassis
      ctx.clip();

      // Wide glowing cyan-white scanner band
      const bandGrad = ctx.createLinearGradient(0, scanY - 12, 0, scanY + 12);
      bandGrad.addColorStop(0, 'rgba(45, 212, 191, 0)');
      bandGrad.addColorStop(0.5, 'rgba(153, 246, 228, 0.72)');
      bandGrad.addColorStop(1, 'rgba(45, 212, 191, 0)');
      ctx.fillStyle = bandGrad;
      ctx.fillRect(0, scanY - 12, 64, 24);

      // Sharp bright core laser sweep line
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, scanY - 2, 64, 4);

      ctx.restore();

      // Bold high-contrast medical cross spanning almost the entire favicon
      ctx.strokeStyle = pulse > 0.55 ? '#FFFFFF' : '#CCFBF1';
      ctx.lineWidth = 8.5;
      ctx.lineCap = 'square';
      ctx.beginPath();
      ctx.moveTo(32, 13);
      ctx.lineTo(32, 51);
      ctx.moveTo(13, 32);
      ctx.lineTo(51, 32);
      ctx.stroke();

      link!.type = 'image/png';
      link!.href = canvas.toDataURL('image/png');
    };

    drawFrame();
    const intervalId = window.setInterval(drawFrame, 90);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);
}

function BrandAnimatedIcon() {
  return (
    <svg viewBox="0 0 32 32" className="w-7 h-7" fill="none" aria-hidden="true">
      <path
        d="M16 3L27 7.2V15.5C27 22.1 22.3 27.2 16 29.3C9.7 27.2 5 22.1 5 15.5V7.2L16 3Z"
        fill="#0F766E"
        fillOpacity="0.1"
        stroke="#0F766E"
        strokeWidth="2.1"
        strokeLinejoin="round"
      />
      <path
        d="M16 10.5V20.5M11 15.5H21"
        stroke="#0F766E"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <line
        x1="7.5"
        y1="15.5"
        x2="24.5"
        y2="15.5"
        stroke="#06B6D4"
        strokeWidth="2.1"
        strokeLinecap="round"
        className="animate-scan-beam"
      />
    </svg>
  );
}

function CardAnimatedIcon({ id }: { id: AppCardId }) {
  if (id === 'ipc-reports') {
    return (
      <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none" aria-hidden="true">
        <rect
          x="8"
          y="7"
          width="24"
          height="27"
          rx="3"
          fill="#0F766E"
          fillOpacity="0.08"
          stroke="#0F766E"
          strokeWidth="2.2"
        />
        <path
          d="M14.5 7V5C14.5 3.9 15.4 3 16.5 3H23.5C24.6 3 25.5 3.9 25.5 5V7"
          stroke="#0F766E"
          strokeWidth="2.2"
        />
        <path
          d="M12.5 21H16L18 15.5L21 26L23 19.5L25 21H27.5"
          stroke="#0F766E"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-pulse-line"
        />
        <g className="animate-scan-beam">
          <rect x="10" y="17.5" width="20" height="5" rx="1" fill="#06B6D4" fillOpacity="0.24" />
          <line
            x1="10"
            y1="20"
            x2="30"
            y2="20"
            stroke="#06B6D4"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
      </svg>
    );
  }

  if (id === 'ipc-training') {
    return (
      <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none" aria-hidden="true">
        <g className="animate-orbit-slow">
          <circle
            cx="20"
            cy="20"
            r="15.5"
            stroke="#06B6D4"
            strokeWidth="2"
            strokeDasharray="10 6"
            strokeLinecap="round"
          />
          <circle cx="20" cy="4.5" r="2.6" fill="#06B6D4" />
        </g>
        <circle
          cx="20"
          cy="20"
          r="11.5"
          stroke="#0F766E"
          strokeOpacity="0.25"
          strokeWidth="1.4"
          strokeDasharray="3 4"
          className="animate-orbit-reverse"
        />
        <g className="animate-droplet-float">
          <path
            d="M20 11.5L30 16L20 20.5L10 16L20 11.5Z"
            fill="#0F766E"
            fillOpacity="0.14"
            stroke="#0F766E"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M14 18.5V24C14 25.8 16.7 27.3 20 27.3C23.3 27.3 26 25.8 26 24V18.5"
            stroke="#0F766E"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </g>
      </svg>
    );
  }

  if (id === 'ipc-competency') {
    return (
      <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none" aria-hidden="true">
        <g className="animate-orbit-slow">
          <circle
            cx="20"
            cy="20"
            r="16"
            stroke="#06B6D4"
            strokeWidth="1.9"
            strokeDasharray="6 6"
            strokeLinecap="round"
          />
          <circle cx="36" cy="20" r="2.2" fill="#06B6D4" />
        </g>
        <polygon
          points="20,7 31,13.5 31,26.5 20,33 9,26.5 9,13.5"
          fill="#0F766E"
          fillOpacity="0.1"
          stroke="#0F766E"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <g className="animate-scan-beam">
          <line
            x1="12"
            y1="20"
            x2="28"
            y2="20"
            stroke="#06B6D4"
            strokeWidth="2"
            strokeOpacity="0.6"
            strokeLinecap="round"
          />
        </g>
        <path
          d="M14.5 20.5L18.2 24.2L26 16"
          stroke="#0F766E"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-pulse-line"
        />
      </svg>
    );
  }

  if (id === 'mms-reports') {
    return (
      <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none" aria-hidden="true">
        <rect
          x="7"
          y="7"
          width="26"
          height="26"
          rx="3.5"
          fill="#0F766E"
          fillOpacity="0.08"
          stroke="#0F766E"
          strokeWidth="2.1"
        />
        <g className="animate-pulse-line">
          <g transform="rotate(-45 20 20)">
            <rect
              x="11"
              y="15.5"
              width="18"
              height="9"
              rx="4.5"
              fill="#0D9488"
              fillOpacity="0.16"
              stroke="#0F766E"
              strokeWidth="2.1"
            />
            <line x1="20" y1="15.5" x2="20" y2="24.5" stroke="#0F766E" strokeWidth="2.1" />
          </g>
        </g>
        <g className="animate-scan-beam">
          <rect x="9.5" y="17.5" width="21" height="5" rx="1" fill="#06B6D4" fillOpacity="0.24" />
          <line
            x1="9.5"
            y1="20"
            x2="30.5"
            y2="20"
            stroke="#06B6D4"
            strokeWidth="2.3"
            strokeLinecap="round"
          />
        </g>
      </svg>
    );
  }

  if (id === 'mms-training') {
    return (
      <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none" aria-hidden="true">
        <g className="animate-orbit-slow">
          <circle
            cx="20"
            cy="20"
            r="15.5"
            stroke="#06B6D4"
            strokeWidth="2"
            strokeDasharray="9 6"
            strokeLinecap="round"
          />
          <circle cx="20" cy="4.5" r="2.5" fill="#06B6D4" />
        </g>
        <circle
          cx="20"
          cy="20"
          r="11.5"
          stroke="#0F766E"
          strokeOpacity="0.25"
          strokeWidth="1.4"
          strokeDasharray="3 4"
          className="animate-orbit-reverse"
        />
        <g className="animate-droplet-float">
          <path
            d="M20 9.5L29 13.3V19.8C29 25 25.2 29 20 30.6C14.8 29 11 25 11 19.8V13.3L20 9.5Z"
            fill="#0F766E"
            fillOpacity="0.12"
            stroke="#0F766E"
            strokeWidth="2.1"
            strokeLinejoin="round"
          />
          <path
            d="M20 15.2V23.8M15.7 19.5H24.3"
            stroke="#0F766E"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 40 40" className="w-10 h-10" fill="none" aria-hidden="true">
      <circle
        cx="20"
        cy="23"
        r="10"
        stroke="#06B6D4"
        strokeWidth="2"
        className="animate-ripple-expand"
      />
      <circle
        cx="20"
        cy="23"
        r="10"
        stroke="#14B8A6"
        strokeWidth="1.8"
        className="animate-ripple-expand-delayed"
      />
      <g className="animate-droplet-float">
        <path
          d="M20 7.5C20 7.5 12 16.8 12 22.8C12 27.2 15.6 30.8 20 30.8C24.4 30.8 28 27.2 28 22.8C28 16.8 20 7.5 20 7.5Z"
          fill="#0D9488"
          fillOpacity="0.15"
          stroke="#0F766E"
          strokeWidth="2.3"
          strokeLinejoin="round"
        />
        <path
          d="M17 23.2C17 25 18.4 26.4 20.2 26.4"
          stroke="#06B6D4"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </g>
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
            <span className="p-px bg-teal-400/90 clinical-icon-chamfer shrink-0">
              <span className="w-11 h-11 bg-teal-50 clinical-icon-chamfer-inner text-teal-700 flex items-center justify-center">
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
              <span className="text-slate-500">مكافحة العدوى وإدارة وسلامة الدواء</span>
            </div>

            <h1 className="font-display text-3xl sm:text-4xl lg:text-[2.65rem] font-bold text-slate-900 leading-[1.22]">
              البوابة الموحدة لتطبيقات مكافحة العدوى وسلامة الدواء
            </h1>

            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-xl">
              منصة دخول مركزي للكوادر الطبية والإدارية للوصول المباشر إلى تطبيقات مكافحة العدوى
              وبرامج إدارة وسلامة الدواء وتقييم الكفاءة المهنية.
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
          className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
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
                  {app.id === 'ipc-competency' && (
                    <>
                      <polygon points="60,18 96,60 60,102 24,60" stroke="currentColor" strokeWidth="1" />
                      <polygon points="60,32 82,60 60,88 38,60" stroke="currentColor" strokeWidth="0.85" />
                      <path d="M60 18V102M24 60H96" stroke="currentColor" strokeWidth="0.7" strokeDasharray="3 3" />
                      <path d="M51 60L57.5 66.5L70 53" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </>
                  )}
                  {app.id === 'mms-reports' && (
                    <>
                      <rect x="22" y="22" width="76" height="76" stroke="currentColor" strokeWidth="0.9" strokeDasharray="4 4" />
                      <g transform="rotate(-45 60 60)">
                        <rect x="30" y="46" width="60" height="28" rx="14" stroke="currentColor" strokeWidth="1.3" />
                        <line x1="60" y1="46" x2="60" y2="74" stroke="currentColor" strokeWidth="1.2" />
                      </g>
                    </>
                  )}
                  {app.id === 'mms-training' && (
                    <>
                      <circle cx="60" cy="60" r="38" stroke="currentColor" strokeWidth="1" strokeDasharray="5 4" />
                      <path d="M60 28L84 38V58C84 73 73.5 84.5 60 89C46.5 84.5 36 73 36 58V38L60 28Z" stroke="currentColor" strokeWidth="1.15" />
                      <path d="M60 45V71M47 58H73" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </>
                  )}
                </svg>

                <div className="relative z-10">
                  <div className="flex items-center justify-between gap-4">
                    <div className="p-px bg-teal-400/90 clinical-icon-chamfer group-hover:bg-teal-600 transition-colors duration-200 shrink-0">
                      <div className="w-16 h-16 bg-gradient-to-br from-teal-50 to-cyan-50/70 clinical-icon-chamfer-inner text-teal-800 flex items-center justify-center group-hover:from-teal-50 group-hover:to-cyan-100/70 transition-colors duration-200">
                        <CardAnimatedIcon id={app.id} />
                      </div>
                    </div>

                    <div className="w-9 h-9 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 group-hover:border-teal-400 group-hover:bg-teal-50 group-hover:text-teal-700 transition-colors duration-200 shrink-0">
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
