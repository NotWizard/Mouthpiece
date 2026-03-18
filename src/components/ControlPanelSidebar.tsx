import React from "react";
import {
  Home,
  BookOpen,
  Download,
  Gift,
  HelpCircle,
  UserCircle,
  Sliders,
  Keyboard,
  Mic,
  Brain,
  Shield,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import SupportDropdown from "./ui/SupportDropdown";
import sidebarAccountState from "../utils/sidebarAccountState";

export type ControlPanelView =
  | "home"
  | "dictionary"
  | "general"
  | "hotkeys"
  | "transcription"
  | "intelligence"
  | "privacyData"
  | "system";

export type SettingsSectionType = ControlPanelView;

interface ControlPanelSidebarProps {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenReferrals?: () => void;
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
  isSignedIn?: boolean;
  authLoaded?: boolean;
  updateAction?: {
    label: string;
    disabled?: boolean;
    onClick: () => void;
  };
}

export default function ControlPanelSidebar({
  activeView,
  onViewChange,
  onOpenReferrals,
  userName,
  userEmail,
  userImage,
  isSignedIn,
  authLoaded,
  updateAction,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
  const { shouldShowSidebarAccountSection } = sidebarAccountState;
  const shouldShowAccountSection = shouldShowSidebarAccountSection({
    isSignedIn,
    userName,
    userEmail,
  });

  const navItems: {
    id: ControlPanelView;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
  }[] = [
    { id: "home", label: t("sidebar.home"), icon: Home },
    { id: "dictionary", label: t("sidebar.dictionary"), icon: BookOpen },
    { id: "general", label: t("settingsModal.sections.general.label"), icon: Sliders },
    { id: "hotkeys", label: t("settingsModal.sections.hotkeys.label"), icon: Keyboard },
    { id: "transcription", label: t("settingsModal.sections.transcription.label"), icon: Mic },
    { id: "intelligence", label: t("settingsModal.sections.intelligence.label"), icon: Brain },
    { id: "privacyData", label: t("settingsModal.sections.privacyData.label"), icon: Shield },
    { id: "system", label: t("settingsModal.sections.system.label"), icon: Wrench },
  ];

  return (
    <div className="w-48 shrink-0 border-r border-border/15 dark:border-white/6 flex flex-col bg-surface-1/60 dark:bg-surface-1">
      <div
        className="w-full h-10 shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      <nav className="flex flex-col gap-0.5 px-2 pt-4 pb-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                "group relative flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md outline-none transition-colors duration-150 text-left",
                "focus-visible:ring-1 focus-visible:ring-primary/30",
                isActive
                  ? "bg-primary/8 dark:bg-primary/10"
                  : "hover:bg-foreground/4 dark:hover:bg-white/4 active:bg-foreground/6"
              )}
            >
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-3.5 rounded-r-full bg-primary" />
              )}
              <Icon
                size={15}
                className={cn(
                  "shrink-0 transition-colors duration-150",
                  isActive
                    ? "text-primary"
                    : "text-foreground/60 group-hover:text-foreground/75 dark:text-foreground/55 dark:group-hover:text-foreground/70"
                )}
              />
              <span
                className={cn(
                  "text-xs transition-colors duration-150",
                  isActive
                    ? "text-foreground font-medium"
                    : "text-foreground/80 group-hover:text-foreground dark:text-foreground/75 dark:group-hover:text-foreground/90"
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="px-2 pb-2 space-y-0.5">
        {updateAction && (
          <button
            onClick={updateAction.onClick}
            disabled={updateAction.disabled}
            aria-label={t("controlPanel.update.availableButton")}
            className={cn(
              "group flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left outline-none transition-colors duration-150",
              "focus-visible:ring-1 focus-visible:ring-primary/30",
              "bg-primary/8 text-primary hover:bg-primary/12 dark:bg-primary/12 dark:hover:bg-primary/16",
              updateAction.disabled && "opacity-70"
            )}
          >
            <Download size={15} className="shrink-0" />
            <span className="text-xs font-medium truncate">{updateAction.label}</span>
          </button>
        )}

        {isSignedIn && onOpenReferrals && (
          <button
            onClick={onOpenReferrals}
            aria-label={t("sidebar.referral")}
            className="group flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left outline-none hover:bg-foreground/4 dark:hover:bg-white/4 focus-visible:ring-1 focus-visible:ring-primary/30 transition-colors duration-150"
          >
            <Gift
              size={15}
              className="shrink-0 text-foreground/60 group-hover:text-foreground/75 dark:text-foreground/50 dark:group-hover:text-foreground/65 transition-colors duration-150"
            />
            <span className="text-xs text-foreground/80 group-hover:text-foreground dark:text-foreground/70 dark:group-hover:text-foreground/85 transition-colors duration-150">
              {t("sidebar.referral")}
            </span>
          </button>
        )}

        <SupportDropdown
          trigger={
            <button
              aria-label={t("sidebar.support")}
              className="group flex items-center gap-2.5 w-full h-8 px-2.5 rounded-md text-left outline-none hover:bg-foreground/4 dark:hover:bg-white/4 focus-visible:ring-1 focus-visible:ring-primary/30 transition-colors duration-150"
            >
              <HelpCircle
                size={15}
                className="shrink-0 text-foreground/60 group-hover:text-foreground/75 dark:text-foreground/50 dark:group-hover:text-foreground/65 transition-colors duration-150"
              />
              <span className="text-xs text-foreground/80 group-hover:text-foreground dark:text-foreground/70 dark:group-hover:text-foreground/85 transition-colors duration-150">
                {t("sidebar.support")}
              </span>
            </button>
          }
        />

        {shouldShowAccountSection && (
          <>
            <div className="mx-1 h-px bg-border/10 dark:bg-white/6 my-1.5!" />

            <div className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md">
              {userImage ? (
                <img
                  src={userImage}
                  alt=""
                  className="w-6 h-6 rounded-full shrink-0 object-cover"
                />
              ) : (
                <UserCircle
                  size={18}
                  className="shrink-0 text-foreground/50 dark:text-foreground/45"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground/80 dark:text-foreground/80 truncate leading-tight">
                  {userName || t("sidebar.defaultUser")}
                </p>
                {userEmail && (
                  <p className="text-xs text-foreground/55 dark:text-foreground/55 truncate leading-tight">
                    {userEmail}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
