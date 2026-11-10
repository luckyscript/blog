export const MOMENT_MEDIA_PREFIX = '/media/moments/';
export const momentMediaName = /^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/;
export function isCachedMomentImage(value: string) {
  return value.startsWith(MOMENT_MEDIA_PREFIX) && momentMediaName.test(value.slice(MOMENT_MEDIA_PREFIX.length));
}
