import React from "react";
import { Check, LucideIcon } from "lucide-react";
import { cn } from "../lib/utils";

interface Step {
  title: string;
  icon: LucideIcon;
}

interface StepProgressProps {
  steps: Step[];
  currentStep: number;
  className?: string;
}

export default function StepProgress({ steps, currentStep, className = "" }: StepProgressProps) {
  return (
    <div className={cn("wizard-step-rail", className)}>
      {steps.map((step, index) => {
        const Icon = step.icon;
        const isActive = index === currentStep;
        const isCompleted = index < currentStep;

        return (
          <React.Fragment key={index}>
            <div
              className={cn(
                "wizard-step-pill transition-colors duration-150",
                isActive && "wizard-step-pill-active",
                isCompleted && "wizard-step-pill-completed"
              )}
            >
              <div className="wizard-step-icon transition-colors duration-150">
                {isCompleted ? (
                  <Check className="w-2.5 h-2.5" strokeWidth={3} />
                ) : (
                  <Icon className="w-2.5 h-2.5" />
                )}
              </div>
              <span
                className="text-xs font-medium tracking-normal"
              >
                {step.title}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "wizard-step-connector transition-colors duration-150",
                  isCompleted && "wizard-step-connector-completed"
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
