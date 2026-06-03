const encodePath = (value: string) =>
  value
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");

const toMinioProxyUrl = (bucket: string, objectKey: string) =>
  `/media/minio/${encodeURIComponent(bucket)}/${encodePath(objectKey)}`;

const isLocalAppImagePath = (value: string) =>
  value.startsWith("/images/") ||
  value.startsWith("images/") ||
  value.startsWith("/media/");

const isInlineOrBrowserUrl = (value: string) =>
  value.startsWith("data:") || value.startsWith("blob:");

const shouldRewriteUrl = (url: URL) => {
  const minioEndpoint = String(process.env.MINIO_ENDPOINT || "").toLowerCase();
  const hostname = url.hostname.toLowerCase();

  return (
    hostname === "minio" ||
    hostname === minioEndpoint ||
    url.port === String(process.env.MINIO_PORT || 9000)
  );
};

export const toPublicImageUrl = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (isInlineOrBrowserUrl(raw) || isLocalAppImagePath(raw)) return raw;

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return raw;
    if (!shouldRewriteUrl(parsed)) return raw;

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const bucket = pathParts.shift() || process.env.MINIO_IMAGE_BUCKET || "inspection-images";
    return toMinioProxyUrl(bucket, pathParts.join("/"));
  } catch {
    const objectKey = raw.replace(/^\/+/, "");
    const bucket = process.env.MINIO_IMAGE_BUCKET || "inspection-images";
    return toMinioProxyUrl(bucket, objectKey);
  }
};

export const withPublicFrameImageUrls = <T extends Record<string, any>>(frame: T): T => ({
  ...frame,
  roi_path: toPublicImageUrl(frame.roi_path),
  mask_path: toPublicImageUrl(frame.mask_path),
  overlay_path: toPublicImageUrl(frame.overlay_path),
});

export const withPublicInspectionImageUrls = <T extends Record<string, any>>(inspection: T): T => ({
  ...inspection,
  frames: Array.isArray(inspection.frames)
    ? inspection.frames.map((frame: Record<string, any>) => withPublicFrameImageUrls(frame))
    : [],
});
