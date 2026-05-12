import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, API_BASE, getToken } from '../lib/api';

// Reusable Excel import modal. The server side (POST /api/<resource>/import)
// parses the file and returns { createdCount, errorCount, created, errors }.
// The user can also download a starter template from
// /api/<resource>/import-template.

export interface ExcelImportProps {
  resource: 'devices' | 'drivers';
  title: string;
  invalidateKeys?: string[]; // react-query keys to refresh after success
  onClose: () => void;
}

export function ExcelImport({ resource, title, invalidateKeys, onClose }: ExcelImportProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ createdCount: number; errorCount: number; created?: any[]; errors?: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      const r = await api.post(`/${resource}/import`, fd);
      return r.data;
    },
    onSuccess: (data) => {
      setResult(data);
      for (const k of invalidateKeys ?? [resource]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Импортлох үед алдаа гарлаа');
    },
  });

  const downloadTemplate = () => {
    fetch(`${API_BASE}/${resource}/import-template`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `fleex-${resource}-template.xlsx`;
        a.click();
      });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </header>

        <div className="p-6 space-y-4">
          {!result && (
            <>
              <ol className="space-y-2 text-sm text-slate-700 list-decimal list-inside">
                <li>Загвар Excel-ийг доорх товчоор татаж аваад өгөгдлөө хуулна.</li>
                <li>Хадгалаад тэр файлаа эндээс upload хийнэ.</li>
                <li>Импорт амжилттай мөрүүд автоматаар үүснэ. Алдаатай мөрийн жагсаалт харагдана.</li>
              </ol>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={downloadTemplate}
                  className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2"
                >
                  📥 Загвар татах (.xlsx)
                </button>
                <button
                  onClick={() => inputRef.current?.click()}
                  className="rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-sm font-medium px-3 py-2"
                >
                  📂 Файл сонгох
                </button>
                <span className="text-xs text-slate-500 truncate">
                  {file ? file.name : 'Файл сонгогдоогүй'}
                </span>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); }}
                />
              </div>

              {error && (
                <div className="rounded-md bg-rose-50 border border-rose-200 text-rose-800 text-sm px-3 py-2">
                  {error}
                </div>
              )}
            </>
          )}

          {result && (
            <ResultPanel result={result} resource={resource} onClose={onClose} />
          )}
        </div>

        {!result && (
          <div className="border-t border-slate-200 px-6 py-3 flex justify-end gap-2 bg-slate-50">
            <button
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-sm font-medium px-4 py-2"
            >
              Цуцлах
            </button>
            <button
              onClick={() => file && mutation.mutate(file)}
              disabled={!file || mutation.isPending}
              className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2 disabled:opacity-50"
            >
              {mutation.isPending ? 'Импортолж байна…' : 'Импортлох'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultPanel({
  result,
  resource,
  onClose,
}: {
  result: { createdCount: number; errorCount: number; created?: any[]; errors?: any[] };
  resource: 'devices' | 'drivers';
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4">
          <div className="text-xs uppercase tracking-widest text-emerald-900 font-semibold">Амжилттай</div>
          <div className="mt-1 text-3xl font-extrabold text-emerald-700 tabular-nums">{result.createdCount}</div>
          <div className="text-xs text-emerald-700 mt-0.5">
            Шинэ {resource === 'devices' ? 'машин' : 'жолооч'} үүссэн
          </div>
        </div>
        <div className={clsx(
          'rounded-xl border p-4',
          result.errorCount > 0 ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-200',
        )}>
          <div className="text-xs uppercase tracking-widest font-semibold text-slate-700">Алдаатай</div>
          <div className={clsx('mt-1 text-3xl font-extrabold tabular-nums', result.errorCount > 0 ? 'text-rose-700' : 'text-slate-500')}>
            {result.errorCount}
          </div>
          <div className="text-xs text-slate-600 mt-0.5">мөр алгассан</div>
        </div>
      </div>

      {result.errors && result.errors.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <header className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-xs uppercase tracking-widest text-slate-500 font-semibold">
            Алдаатай мөрүүд
          </header>
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-widest text-slate-500">
                <tr><th className="text-left px-4 py-1.5">Мөр</th><th className="text-left px-4 py-1.5">Шалтгаан</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.errors.map((e, i) => (
                  <tr key={i}>
                    <td className="px-4 py-1.5 text-slate-600 tabular-nums">{e.row}</td>
                    <td className="px-4 py-1.5 text-rose-700">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold px-5 py-2"
        >
          Хаах
        </button>
      </div>
    </div>
  );
}
