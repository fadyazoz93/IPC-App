import React from 'react';
import { FacilityLeaders } from '../../types/portal';

interface LeadersReportHeaderProps {
  facilityName: string;
  reportTitle: string;
  leaders?: FacilityLeaders;
  dateLabel?: string;
}

export const LeadersSignatureStrip: React.FC<{ leaders?: FacilityLeaders; facilityName: string; reportTitle: string }> = ({
  leaders,
  facilityName,
  reportTitle,
}) => {
  if (!leaders) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-100">
        <div>
          <p className="text-xs font-medium text-slate-500">ترويسة الاعتماد والتوقيعات الرسمية للمركز</p>
          <h4 className="text-sm font-bold text-slate-900 mt-0.5">
            {facilityName} — {reportTitle}
          </h4>
        </div>
        <span className="text-xs text-slate-500 tabular-nums">
          تاريخ الإصدار: {new Date().toLocaleDateString('ar-EG')}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="block text-xs text-slate-500">مدير المستشفى / المركز</span>
          <span className="mt-1 block font-semibold text-slate-900">{leaders.hospital_director}</span>
        </div>
        <div>
          <span className="block text-xs text-slate-500">مدير الجودة</span>
          <span className="mt-1 block font-semibold text-slate-900">{leaders.quality_director}</span>
        </div>
        <div>
          <span className="block text-xs text-slate-500">مشرف مكافحة العدوى</span>
          <span className="mt-1 block font-semibold text-slate-900">{leaders.ic_supervisor}</span>
        </div>
        <div>
          <span className="block text-xs text-slate-500">رئيس التمريض</span>
          <span className="mt-1 block font-semibold text-slate-900">{leaders.nursing_director}</span>
        </div>
      </div>
    </div>
  );
};

export const PrintableDocumentHeader: React.FC<LeadersReportHeaderProps> = ({
  facilityName,
  reportTitle,
  leaders,
  dateLabel,
}) => {
  return (
    <div className="hidden print-only mb-6 border-b-2 border-slate-800 pb-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-600">البوابة الطبية الموحدة متعددة المراكز</p>
          <h1 className="text-xl font-bold text-slate-900 mt-1">{facilityName}</h1>
          <h2 className="text-base font-semibold text-slate-700 mt-0.5">{reportTitle}</h2>
        </div>
        <div className="text-left text-xs text-slate-600 tabular-nums">
          <p>تاريخ الطباعة: {dateLabel || new Date().toLocaleDateString('ar-EG')}</p>
        </div>
      </div>
      {leaders && (
        <div className="mt-4 pt-3 border-t border-slate-200 grid grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-slate-500">مدير المركز:</span>{' '}
            <strong className="text-slate-900">{leaders.hospital_director}</strong>
          </div>
          <div>
            <span className="text-slate-500">مدير الجودة:</span>{' '}
            <strong className="text-slate-900">{leaders.quality_director}</strong>
          </div>
          <div>
            <span className="text-slate-500">مكافحة العدوى:</span>{' '}
            <strong className="text-slate-900">{leaders.ic_supervisor}</strong>
          </div>
          <div>
            <span className="text-slate-500">رئيس التمريض:</span>{' '}
            <strong className="text-slate-900">{leaders.nursing_director}</strong>
          </div>
        </div>
      )}
    </div>
  );
};
