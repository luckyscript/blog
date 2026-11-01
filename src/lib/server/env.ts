export function env(name: string, fallback = ""): string {
  // Secrets belong to the running process, never Vite's build-time env object.
  return process.env[name] ?? fallback;
}

export function usesDatabase() {
  return (
    env("CONTENT_SOURCE", env("DATABASE_URL") ? "mysql" : "markdown") ===
    "mysql"
  );
}

export function databaseConfigured() {
  return Boolean(env("DATABASE_URL"));
}
