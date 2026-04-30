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
    <div className="control-panel-sidebar shrink-0 flex flex-col">
      <div
        className="w-full h-10 shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      <nav className="control-panel-sidebar-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={cn(
                "control-panel-sidebar-item group transition-colors duration-150",
                isActive && "control-panel-sidebar-item-active"
              )}
            >
              <Icon
                size={15}
                className={cn(
                  "shrink-0 transition-colors duration-150",
                  isActive
                    ? "text-current"
                    : "text-foreground/55 group-hover:text-foreground/75"
                )}
              />
              <span
                className={cn(
                  "text-xs transition-colors duration-150",
                  isActive ? "font-medium text-current" : "text-current"
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="control-panel-sidebar-footer space-y-1">
        {updateAction && (
          <button
            onClick={updateAction.onClick}
            disabled={updateAction.disabled}
            aria-label={t("controlPanel.update.availableButton")}
            className={cn(
              "control-panel-sidebar-item text-left text-primary",
              "bg-primary/8 hover:bg-primary/12 dark:bg-primary/12 dark:hover:bg-primary/16",
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
            className="control-panel-sidebar-item group transition-colors duration-150"
          >
            <Gift
              size={15}
              className="shrink-0 text-foreground/50 group-hover:text-foreground/75 transition-colors duration-150"
            />
            <span className="text-xs text-current transition-colors duration-150">
              {t("sidebar.referral")}
            </span>
          </button>
        )}

        <SupportDropdown
          trigger={
            <button
              aria-label={t("sidebar.support")}
              className="control-panel-sidebar-item group transition-colors duration-150"
            >
              <HelpCircle
                size={15}
                className="shrink-0 text-foreground/50 group-hover:text-foreground/75 transition-colors duration-150"
              />
              <span className="text-xs text-current transition-colors duration-150">
                {t("sidebar.support")}
              </span>
            </button>
          }
        />

        {shouldShowAccountSection && (
          <>
            <div className="h-px bg-border/60 dark:bg-white/8 my-1.5!" />

            <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md">
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
