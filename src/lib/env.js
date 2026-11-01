export function getEnv(name, Astro) {
  return process.env[name] ?? Astro.locals?.runtime?.env?.[name]
}
