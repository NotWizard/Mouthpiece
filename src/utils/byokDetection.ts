const hasValue = (value?: string | null) => Boolean(value && value.trim());

export const hasAnyByokKey = (values: Array<string | null | undefined>) => values.some(hasValue);
