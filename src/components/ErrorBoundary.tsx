import React from "react";
import i18n from "../i18n";
import { Button } from "./ui/button";
import { ErrorNotice } from "./ui/ErrorNotice";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);
    window.electronAPI?.log?.({
      level: "error",
      scope: "error-boundary",
      source: "renderer",
      message: "Renderer uncaught error",
      meta: {
        name: error?.name,
        message: error?.message,
        stack: error?.stack,
        componentStack: errorInfo?.componentStack,
      },
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,227,214,0.35),transparent_36%),var(--color-background)] flex items-center justify-center p-6">
          <div className="dialog-premium-shell max-w-md rounded-[28px] p-6 text-center space-y-4">
            <h1 className="text-lg font-semibold text-foreground brand-heading">
              {i18n.t("errorBoundary.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{i18n.t("errorBoundary.description")}</p>
            {this.state.error && (
              <>
                <ErrorNotice message={this.state.error.message} compact />
                <pre className="error-code-panel text-xs rounded-[16px] p-3 overflow-auto max-h-32 text-left text-[rgba(90,39,30,0.82)] dark:text-[rgba(255,236,230,0.82)]">
                  {this.state.error.message}
                </pre>
              </>
            )}
            <Button onClick={this.handleReload} className="w-full">
              {i18n.t("errorBoundary.reload")}
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
