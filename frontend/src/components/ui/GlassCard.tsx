import type { ReactNode, HTMLAttributes } from 'react';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}

export default function GlassCard({ children, className = '', padding = true, ...props }: GlassCardProps) {
  return (
    <div
      className={`backdrop-blur-md bg-white/5 border border-white/10 rounded-xl ${padding ? 'p-6' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
