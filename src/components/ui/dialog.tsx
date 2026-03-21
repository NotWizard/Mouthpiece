import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CircleAlert, Info, X } from "lucide-react";

import ERROR_SURFACE_LAYOUT from "../../config/errorSurfaceLayout.json";
import { cn } from "../lib/utils";
import { Button } from "./button";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

type DialogTone = "default" | "destructive";

const dialogToneBadgeClasses: Record<DialogTone, string> = {
  default:
    "border-white/70 bg-white/82 text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_16px_28px_-24px_rgba(15,23,42,0.38)] dark:border-white/10 dark:bg-white/6 dark:text-slate-200 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_30px_-24px_rgba(0,0,0,0.62)]",
  destructive:
    "border-[rgba(198,105,79,0.18)] bg-[linear-gradient(180deg,rgba(255,245,240,0.96),rgba(255,233,225,0.92))] text-[rgba(163,72,50,0.92)] shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_18px_30px_-22px_rgba(166,72,48,0.28)] dark:border-[rgba(255,174,148,0.16)] dark:bg-[linear-gradient(180deg,rgba(86,50,41,0.9),rgba(52,30,24,0.9))] dark:text-[rgba(255,205,186,0.94)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_20px_34px_-22px_rgba(0,0,0,0.68)]",
};

const dialogToneTextClasses: Record<DialogTone, string> = {
  default: "text-foreground",
  destructive: "text-[rgba(80,33,24,0.96)] dark:text-[rgba(255,239,232,0.96)]",
};

function DialogToneBadge({ variant }: { variant: DialogTone }) {
  const Icon = variant === "destructive" ? CircleAlert : Info;

  return (
    <div
      className={cn(
        "relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[16px] border backdrop-blur-xl",
        dialogToneBadgeClasses[variant]
      )}
      aria-hidden="true"
    >
      <Icon className="h-5 w-5" />
    </div>
  );
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "dialog-premium-overlay fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  variant?: DialogTone;
  hideClose?: boolean;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, variant = "default", hideClose = false, ...props }, ref) => {
  const dialogMaxWidthPx =
    variant === "destructive"
      ? ERROR_SURFACE_LAYOUT.dialogs.destructiveMaxWidthPx
      : ERROR_SURFACE_LAYOUT.dialogs.defaultMaxWidthPx;

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "dialog-premium-shell fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-1.5rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-[24px] p-5 sm:w-full sm:p-6",
          variant === "destructive" && "dialog-premium-shell-destructive",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-[0.985] data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]",
          className
        )}
        style={{ maxWidth: dialogMaxWidthPx }}
        {...props}
      >
        <div className="relative z-[1]">{children}</div>

        {!hideClose && (
          <DialogPrimitive.Close
            type="button"
            className={cn(
              "dialog-premium-close absolute right-3.5 top-3.5 z-[2] rounded-full p-2 transition-[background-color,border-color,color,transform] duration-200 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-ring/25 focus:ring-offset-0 disabled:pointer-events-none"
            )}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-3 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "mt-1 flex flex-col-reverse gap-2 border-t border-[rgba(120,91,72,0.1)] pt-4 dark:border-white/8 sm:flex-row sm:justify-end",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-[1.1rem] font-semibold leading-tight tracking-[-0.025em] text-foreground brand-heading",
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-[0.94rem] leading-6 text-muted-foreground/90 brand-body", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  variant?: DialogTone;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  variant = "default",
}) => {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleCancel();
      return;
    }

    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent variant={variant}>
        <DialogHeader>
          <DialogToneBadge variant={variant} />
          <div className="space-y-2">
            <DialogTitle className={dialogToneTextClasses[variant]}>{title}</DialogTitle>
            {description && (
              <DialogDescription
                className={variant === "destructive" ? dialogToneTextClasses[variant] : undefined}
              >
                {description}
              </DialogDescription>
            )}
          </div>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            {cancelText}
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={handleConfirm}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  okText?: string;
  onOk: () => void;
  variant?: DialogTone;
}

const AlertDialog: React.FC<AlertDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  okText = "OK",
  onOk,
  variant = "default",
}) => {
  const handleOk = () => {
    onOk();
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onOpenChange(false);
      return;
    }

    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent variant={variant}>
        <DialogHeader>
          <DialogToneBadge variant={variant} />
          <div className="space-y-2">
            <DialogTitle className={dialogToneTextClasses[variant]}>{title}</DialogTitle>
            {description && (
              <DialogDescription
                className={variant === "destructive" ? dialogToneTextClasses[variant] : undefined}
              >
                {description}
              </DialogDescription>
            )}
          </div>
        </DialogHeader>

        <DialogFooter>
          <Button variant="default" onClick={handleOk}>
            {okText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  ConfirmDialog,
  AlertDialog,
};
