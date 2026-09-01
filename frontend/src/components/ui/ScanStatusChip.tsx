type ScanStatus = 'pending' | 'running' | 'completed' | 'stopped' | 'failed';

interface ScanStatusChipProps {
  status: ScanStatus | string;
  className?: string;
}

const statusConfig: Record<string, { label: string; className: string; dot?: boolean }> = {
  running: {
    label: 'Running',
    className: 'bg-green-500/20 text-green-400 border border-green-500/40',
    dot: true,
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
  },
  pending: {
    label: 'Pending',
    className: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
  },
  stopped: {
    label: 'Stopped',
    className: 'bg-gray-500/20 text-gray-400 border border-gray-500/40',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/20 text-red-400 border border-red-500/40',
  },
};

export default function ScanStatusChip({ status, className = '' }: ScanStatusChipProps) {
  const normalized = status?.toLowerCase() ?? 'pending';
  const config = statusConfig[normalized] ?? statusConfig.pending;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${config.className} ${className}`}>
      {config.dot && (
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
      )}
      {config.label}
    </span>
  );
}
