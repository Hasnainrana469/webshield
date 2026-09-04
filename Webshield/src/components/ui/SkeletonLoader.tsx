interface SkeletonLoaderProps {
  className?: string;
  lines?: number;
  height?: string;
}

export function SkeletonLine({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse bg-white/10 rounded ${className}`} />
  );
}

export default function SkeletonLoader({ className = '', lines = 3, height = 'h-4' }: SkeletonLoaderProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={`animate-pulse bg-white/10 rounded ${height} ${i === lines - 1 ? 'w-3/4' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`backdrop-blur-md bg-white/5 border border-white/10 rounded-xl p-6 ${className}`}>
      <SkeletonLoader lines={4} />
    </div>
  );
}
