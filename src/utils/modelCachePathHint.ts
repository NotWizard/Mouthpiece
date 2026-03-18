export function getModelCachePathHint({
  userAgent = "",
  cacheDirName,
}: {
  userAgent?: string;
  cacheDirName: string;
}) {
  if (/Windows/i.test(userAgent)) {
    return `%USERPROFILE%\\.cache\\${cacheDirName}`;
  }

  return `~/.cache/${cacheDirName}`;
}
