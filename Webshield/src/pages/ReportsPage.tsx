import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import GlassCard from '../components/ui/GlassCard';
import SkeletonLoader from '../components/ui/SkeletonLoader';

interface Report {
  id: string;
  scan_id: string;
  format: 'pdf' | 'html';
  file_size_bytes: number | null;
  created_at: string;
  scan?: {
    target_url: string;
  };
}

interface ReportsResponse {
  data: Report[];
  total: number;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ReportsPage() {
  const { data, isLoading, error } = useQuery<ReportsResponse>({
    queryKey: ['reports'],
    queryFn: () => api.get<ReportsResponse>('/reports'),
  });

  // Group by scan_id so each scan shows both PDF and HTML
  const groupedReports = data?.data.reduce<Record<string, Report[]>>((acc, report) => {
    const key = report.scan_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(report);
    return acc;
  }, {}) ?? {};

  const handleDownload = (reportId: string, format: 'pdf' | 'html') => {
    const token = localStorage.getItem('token');
    const url = `/api/v1/reports/${reportId}/download/${format}`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `report-${reportId}.${format}`);
    // For authenticated downloads we set the token via fetch + blob
    fetch(url, {
      headers: { Authorization: `Bearer ${token ?? ''}` },
    })
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        link.href = blobUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {
        // fallback — open in new tab
        window.open(url, '_blank');
      });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Reports</h1>
        <p className="text-gray-400 text-sm mt-1">Download PDF and HTML security reports for your completed scans</p>
      </div>

      <GlassCard padding={false}>
        {isLoading ? (
          <div className="p-6"><SkeletonLoader lines={6} height="h-12" /></div>
        ) : error ? (
          <div className="p-8 text-center text-red-400 text-sm">Failed to load reports.</div>
        ) : Object.keys(groupedReports).length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-4xl mb-4">📄</div>
            <p className="text-gray-300 font-medium mb-2">No reports yet</p>
            <p className="text-gray-400 text-sm">Generate a report from a completed scan.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {Object.entries(groupedReports).map(([scanId, reports]) => {
              const scanUrl = reports[0]?.scan?.target_url ?? scanId.slice(0, 8) + '...';
              const createdAt = reports[0]?.created_at;

              return (
                <div key={scanId} className="p-5 hover:bg-white/2 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-white font-medium">{scanUrl}</p>
                      <p className="text-gray-400 text-xs mt-1">
                        Generated {createdAt ? new Date(createdAt).toLocaleString() : '—'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {reports.map((report) => (
                        <button
                          key={report.id}
                          type="button"
                          onClick={() => handleDownload(report.id, report.format)}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            report.format === 'pdf'
                              ? 'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20'
                              : 'bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20'
                          }`}
                        >
                          {report.format === 'pdf' ? '📥 PDF' : '🌐 HTML'}
                          {report.file_size_bytes && (
                            <span className="text-xs opacity-70">({formatBytes(report.file_size_bytes)})</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
