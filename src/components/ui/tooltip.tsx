import React, { useState } from "react";

interface TooltipProps {
  children: React.ReactNode;
  content: string;
}

export const Tooltip = ({ children, content }: TooltipProps) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <div onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
        {children}
      </div>
      {isVisible && (
        <div className="popover-glass-surface absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2.5 py-1.5 text-xs font-medium text-foreground rounded-md whitespace-nowrap z-50 animate-in fade-in-0 zoom-in-95 duration-150">
          {content}
        </div>
      )}
    </div>
  );
};
