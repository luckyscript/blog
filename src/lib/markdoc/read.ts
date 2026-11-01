import type { z } from "zod";
import path from "path";
import matter from "gray-matter";
import fs from "fs/promises";
import { globby } from "globby";
import { usesDatabase } from '../server/env';
import { databaseReadOne, databaseReadAll, databaseReadGroups } from '../server/public-content';
import { parseAndTransform, renderHtml } from './render';
import { AppError } from '../server/errors';
export { parseAndTransform } from './render';

// path is relative to where you run the `yarn build` command
const contentDirectory = path.normalize("./content");

function validateFrontmatter<T extends z.ZodTypeAny>({
  frontmatter,
  schema,
  filepath,
}: {
  frontmatter: { [key: string]: unknown };
  schema: T;
  filepath: string;
}) {
  try {
    const validatedFrontmatter = schema.parse(frontmatter);
    return validatedFrontmatter as z.infer<T>;
  } catch (e) {
    const errMessage = `
      There was an error validating your frontmatter. 
      Please make sure your frontmatter for file: ${filepath} matches its schema.
    `;
    throw Error(errMessage + (e as Error).message);
  }
}

export async function read<T extends z.ZodTypeAny>({
  filepath,
  schema,
}: {
  filepath: string;
  schema: T;
}) {
  const rawString = await fs.readFile(filepath, "utf8");
  const { content, data: frontmatter } = matter(rawString);
  const transformedContent = await parseAndTransform({ content });
  const html = renderHtml(transformedContent);
  const brief = await parseAndTransform({ content: content.split('<!--more-->')[0] })
  const validatedFrontmatter = validateFrontmatter({
    frontmatter,
    schema,
    filepath,
  });

  const filename = filepath.split("/").pop();
  if (typeof filename !== "string") {
    throw new Error("Check what went wrong");
  }
  const fileNameWithoutExtension = filename.replace(/\.[^.]*$/, "");

  return {
    slug: fileNameWithoutExtension,
    content: transformedContent,
    brief,
    rawContent: content,
    frontmatter: validatedFrontmatter,
    html,
  };
}

export async function readOne<T extends z.ZodTypeAny>({
  directory,
  slug,
  frontmatterSchema: schema,
}: {
  directory: string;
  slug: string;
  frontmatterSchema: T;
}) {
  if (usesDatabase()) return databaseReadOne(directory, slug);
  const filepath = path.join(contentDirectory, directory, `${slug}.md`);
  if (!path.resolve(filepath).startsWith(path.resolve(contentDirectory) + path.sep)) throw new AppError(404, '文章不存在');
  const post = await read({
    filepath,
    schema,
  }).catch((error: any) => { if (error.code === 'ENOENT') throw new AppError(404, '文章不存在'); throw error; });
  if ((post.frontmatter as any).draft) throw new AppError(404, '文章尚未发布');
  return post;
}

export async function readAll<T extends z.ZodTypeAny>({
  directory,
  frontmatterSchema: schema,
}: {
  directory: string;
  frontmatterSchema: T;
}) {
  if (usesDatabase()) return databaseReadAll(directory);
  const pathToDir = path.posix.join(contentDirectory, directory);
  const paths = await globby(`${pathToDir}/*.md`);

  return Promise.all(paths.map((path) => read({ filepath: path, schema })));
}

export async function readBlog<T extends z.ZodTypeAny>({
  frontmatterSchema: schema,
}: {
  frontmatterSchema: T;
}) {
  if (usesDatabase()) return databaseReadGroups('blog');
  const pathToDir = path.posix.join(contentDirectory, 'blog');
  const years = await fs.readdir(pathToDir, { withFileTypes: true});
  return Promise.all(years.filter(item => item.isDirectory()).map(async item => ({
    year: item.name,
    posts: await readAll({ directory: `blog/${item.name}`, frontmatterSchema: schema }),
  })));
}

export async function readSight<T extends z.ZodTypeAny>({
  frontmatterSchema: schema,
}: {
  frontmatterSchema: T;
}) {
  if (usesDatabase()) return databaseReadGroups('sight');
  const pathToDir = path.posix.join(contentDirectory, 'sight');
  const years = await fs.readdir(pathToDir, { withFileTypes: true});
  return Promise.all(years.filter(item => item.isDirectory()).map(async item => ({
    year: item.name,
    posts: await readAll({ directory: `sight/${item.name}`, frontmatterSchema: schema }),
  })));
}

export async function readTech<T extends z.ZodTypeAny>({
  frontmatterSchema: schema,
}: {
  frontmatterSchema: T;
}) {
  if (usesDatabase()) return databaseReadGroups('tech');
  const pathToDir = path.posix.join(contentDirectory, 'tech');
  const years = await fs.readdir(pathToDir, { withFileTypes: true});
  return Promise.all(years.filter(item => item.isDirectory()).map(async item => ({
    year: item.name,
    posts: await readAll({ directory: `tech/${item.name}`, frontmatterSchema: schema }),
  })));
}
