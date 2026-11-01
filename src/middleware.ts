import { defineMiddleware } from "astro:middleware";
import { and, eq, lte } from "drizzle-orm";
import { sessionUser } from "./lib/server/auth";
import { databaseConfigured, usesDatabase } from "./lib/server/env";
import { AppError } from "./lib/server/errors";
import { db } from "./db";
import { posts, redirects } from "./db/schema";

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const adminPage = path === "/admin" || path.startsWith("/admin/");
  const adminApi = path.startsWith("/api/admin/");
  try {
    if (adminPage || adminApi) {
      if (
        adminApi &&
        !["GET", "HEAD", "OPTIONS"].includes(context.request.method)
      ) {
        if (context.request.headers.get("origin") !== context.url.origin)
          throw new AppError(403, "请求来源校验失败，请从本站后台重试");
      }
      const isLogin =
        path === "/admin/login" || path === "/api/admin/auth/login";
      if (!isLogin) {
        if (!databaseConfigured()) {
          if (adminPage) return context.redirect("/admin/login");
          throw new AppError(503, "请先配置 MySQL，并执行 npm run db:setup");
        }
        context.locals.admin = await sessionUser(context);
        if (!context.locals.admin) {
          if (adminPage) return context.redirect("/admin/login");
          throw new AppError(401, "登录已过期，请重新登录");
        }
      }
    }
    const response = await next();
    if (adminPage || adminApi) {
      response.headers.set("cache-control", "private, no-store");
      response.headers.set("x-robots-tag", "noindex, nofollow");
      response.headers.set(
        "x-frame-options",
        path.startsWith("/admin/preview/") ? "SAMEORIGIN" : "DENY"
      );
      response.headers.set("referrer-policy", "same-origin");
      response.headers.set("x-content-type-options", "nosniff");
    } else if (response.status === 404 && usesDatabase()) {
      const [target] = await db()
        .select({ path: posts.path })
        .from(redirects)
        .innerJoin(posts, eq(posts.id, redirects.postId))
        .where(
          and(
            eq(redirects.path, decodeURI(path).replace(/\/$/, "")),
            eq(posts.status, "published"),
            lte(posts.publishedAt, new Date())
          )
        );
      if (target) return context.redirect(target.path, 301);
    }
    if (!adminPage && !adminApi && usesDatabase())
      response.headers.set("cache-control", "no-cache");
    return response;
  } catch (error) {
    if (
      error instanceof AppError &&
      error.status === 404 &&
      usesDatabase() &&
      !adminApi &&
      !adminPage
    ) {
      const [target] = await db()
        .select({ path: posts.path })
        .from(redirects)
        .innerJoin(posts, eq(posts.id, redirects.postId))
        .where(
          and(
            eq(redirects.path, decodeURI(path).replace(/\/$/, "")),
            eq(posts.status, "published"),
            lte(posts.publishedAt, new Date())
          )
        );
      if (target) return context.redirect(target.path, 301);
    }
    const status = error instanceof AppError ? error.status : 503;
    const message =
      error instanceof AppError
        ? error.message
        : path.startsWith("/moments") || path.startsWith("/telegramProxy")
        ? "暂时无法连接碎碎念来源，请稍后重试"
        : "页面暂时不可用，请检查服务与数据库连接";
    if (adminApi)
      return new Response(JSON.stringify({ error: message }), {
        status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    return new Response(status === 404 ? "文章不存在或尚未发布" : message, {
      status,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
});
