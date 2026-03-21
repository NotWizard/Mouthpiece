import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const alertVariants = cva(
  [
    "alert-premium relative w-full rounded-[18px] border px-4 py-3.5 text-sm",
    "backdrop-blur-xl [&>svg+div]:translate-y-[-2px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-8",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "text-foreground/90 [&>svg]:text-muted-foreground",
        destructive:
          "alert-premium-destructive text-[rgba(86,39,34,0.96)] dark:text-[rgba(255,236,230,0.96)] [&>svg]:text-[rgba(176,88,67,0.84)] dark:[&>svg]:text-[rgba(255,186,162,0.88)]",
        success:
          "border-emerald-500/18 bg-[linear-gradient(180deg,rgba(243,253,247,0.96),rgba(225,248,235,0.92))] text-emerald-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_18px_40px_-32px_rgba(22,163,74,0.28)] dark:border-emerald-400/16 dark:bg-[linear-gradient(180deg,rgba(25,52,39,0.92),rgba(18,35,28,0.9))] dark:text-emerald-50 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-300",
        warning:
          "border-amber-500/20 bg-[linear-gradient(180deg,rgba(255,251,235,0.96),rgba(254,243,199,0.92))] text-amber-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_18px_40px_-32px_rgba(217,119,6,0.26)] dark:border-amber-400/16 dark:bg-[linear-gradient(180deg,rgba(60,42,18,0.92),rgba(38,27,14,0.9))] dark:text-amber-50 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn("mb-1 font-semibold leading-none tracking-[-0.01em] text-inherit", className)}
      {...props}
    />
  )
);
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-inherit [&_p]:leading-relaxed", className)}
    {...props}
  />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
