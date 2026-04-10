"use client";

import { HelpCircle as HelpCircleIcon } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface HelpCircleProps {
  text: string;
  className?: string;
}

export function HelpCircle({ text, className }: HelpCircleProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        className={`inline-flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-muted-foreground transition-colors ${className ?? ""}`}
      >
        <HelpCircleIcon className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-[220px]">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
