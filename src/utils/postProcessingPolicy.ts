import type { ContextClassification, ReasoningContext } from "./contextClassifier";

export type OutputStrategy = "raw_first" | "light_polish" | "publishable" | "structured_rewrite";
export type InputSurfaceMode =
  | "general"
  | "chat"
  | "email"
  | "document"
  | "search"
  | "form"
  | "markdown"
  | "ide";

export interface PostProcessingPolicy {
  surfaceMode: InputSurfaceMode;
  outputStrategy: OutputStrategy;
  allowStructuredRewrite: boolean;
  preserveIdentifiers: boolean;
  preserveFormatting: boolean;
}

const FALLBACK_SURFACE_MODE: InputSurfaceMode = "general";
const FALLBACK_OUTPUT_STRATEGY: OutputStrategy = "light_polish";

const SURFACE_MODE_BY_CONTEXT: Record<ReasoningContext, InputSurfaceMode> = {
  general: "general",
  code: "ide",
  email: "email",
  chat: "chat",
  document: "document",
  search: "search",
  form: "form",
  markdown: "markdown",
  ide: "ide",
};

export function normalizeInputSurfaceMode(value?: string | null): InputSurfaceMode {
  switch (value) {
    case "general":
    case "chat":
    case "email":
    case "document":
    case "search":
    case "form":
    case "markdown":
    case "ide":
      return value;
    default:
      return FALLBACK_SURFACE_MODE;
  }
}

export function normalizeOutputStrategy(value?: string | null): OutputStrategy {
  switch (value) {
    case "raw_first":
    case "light_polish":
    case "publishable":
    case "structured_rewrite":
      return value;
    default:
      return FALLBACK_OUTPUT_STRATEGY;
  }
}

function deriveSurfaceMode(contextClassification?: ContextClassification | null): InputSurfaceMode {
  if (!contextClassification) {
    return FALLBACK_SURFACE_MODE;
  }

  return SURFACE_MODE_BY_CONTEXT[contextClassification.context] || FALLBACK_SURFACE_MODE;
}

function deriveOutputStrategy(surfaceMode: InputSurfaceMode): OutputStrategy {
  if (surfaceMode === "ide" || surfaceMode === "search" || surfaceMode === "form") {
    return "raw_first";
  }

  if (surfaceMode === "email" || surfaceMode === "document") {
    return "publishable";
  }

  return "light_polish";
}

export function resolvePostProcessingPolicy({
  contextClassification,
  preferredSurfaceMode,
  preferredOutputStrategy,
}: {
  contextClassification?: ContextClassification | null;
  preferredSurfaceMode?: InputSurfaceMode | null;
  preferredOutputStrategy?: OutputStrategy | null;
} = {}): PostProcessingPolicy {
  const surfaceMode = normalizeInputSurfaceMode(
    preferredSurfaceMode || deriveSurfaceMode(contextClassification)
  );
  const outputStrategy = normalizeOutputStrategy(
    preferredOutputStrategy || deriveOutputStrategy(surfaceMode)
  );

  return {
    surfaceMode,
    outputStrategy,
    allowStructuredRewrite: outputStrategy === "structured_rewrite",
    preserveIdentifiers: surfaceMode === "ide",
    preserveFormatting:
      surfaceMode === "markdown" || surfaceMode === "document" || surfaceMode === "email",
  };
}
