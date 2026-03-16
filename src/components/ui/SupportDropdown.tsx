import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { HelpCircle, Mail, Bug } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { cn } from "../lib/utils";

interface SupportDropdownProps {
  className?: string;
  trigger?: React.ReactNode;
}

export default function SupportDropdown({ className, trigger }: SupportDropdownProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger || (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "text-foreground/70 hover:text-foreground hover:bg-foreground/10",
              className
            )}
          >
            <HelpCircle size={16} />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled>
          <Mail className="mr-2 h-4 w-4" />
          {t("support.contactSupport")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Bug className="mr-2 h-4 w-4" />
          {t("support.submitBug")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
