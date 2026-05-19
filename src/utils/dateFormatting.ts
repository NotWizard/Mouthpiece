export function normalizeDbDate(dateStr: string): Date {
  const source = dateStr.endsWith("Z") ? dateStr : `${dateStr}Z`;
  return new Date(source);
}

export interface DateGroupParts {
  /** Stable identity used for grouping consecutive items into the same day. */
  key: string;
  /** Headline label — Today / Yesterday / weekday / full date depending on recency. */
  primary: string;
  /** Optional secondary detail — full date · weekday, or weekday alone, or undefined. */
  secondary?: string;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function formatDateGroupParts(
  date: Date | string,
  t: (key: string) => string,
  locale?: string,
): DateGroupParts {
  const d = typeof date === "string" ? new Date(date) : date;
  const target = startOfDay(d);
  const today = startOfDay(new Date());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  const fullDate = d.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const weekday = d.toLocaleDateString(locale, { weekday: "short" });
  const key = `${target.getFullYear()}-${target.getMonth()}-${target.getDate()}`;

  if (diffDays === 0) {
    return {
      key,
      primary: t("controlPanel.history.dateGroups.today"),
      secondary: `${fullDate} · ${weekday}`,
    };
  }
  if (diffDays === 1) {
    return {
      key,
      primary: t("controlPanel.history.dateGroups.yesterday"),
      secondary: `${fullDate} · ${weekday}`,
    };
  }
  if (diffDays >= 2 && diffDays <= 6) {
    return { key, primary: weekday, secondary: fullDate };
  }
  return { key, primary: fullDate, secondary: weekday };
}
