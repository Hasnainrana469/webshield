type RiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'informational';

interface RiskBadgeProps {
  level: RiskLevel | string;
  className?: string;
}

const riskStyles: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border border-red-500/40',
  high: 'bg-orange-500/20 text-orange-400 border border-orange-500/40',
  medium: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
  low: 'bg-green-500/20 text-green-400 border border-green-500/40',
  informational: 'bg-gray-500/20 text-gray-400 border border-gray-500/40',
};

export default function RiskBadge({ level, className = '' }: RiskBadgeProps) {
  const normalized = level?.toLowerCase() ?? 'informational';
  const style = riskStyles[normalized] ?? riskStyles.informational;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${style} ${className}`}>
      {normalized}
    </span>
  );
}
