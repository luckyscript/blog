import type { z } from "zod";
import path from "path";
import matter from "gray-matter";
import fs from "fs/promises";
import { globby } from "globby";
import Markdoc from "@markdoc/markdoc";
import { config } from "./markdoc.config";

// path is relative to where you run the `yarn build` command
const contentDirectory = path.normalize("./content");

export async function parseAndTransform({ content }: { content: string }) {
  const ast = Markdoc.parse(content);

  const errors = Markdoc.validate(ast, config);
  if (errors.length) {
    console.error(errors);
    throw new Error("Markdoc validation error");
  }
  const transformedContent = Markdoc.transform(ast, config);

  return transformedContent;
}

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
  const html = Markdoc.renderers.html(transformedContent);
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
  const filepath = path.join(contentDirectory, directory, `${slug}.md`);
  return read({
    filepath,
    schema,
  });
}

export async function readAll<T extends z.ZodTypeAny>({
  directory,
  frontmatterSchema: schema,
}: {
  directory: string;
  frontmatterSchema: T;
}) {
  const pathToDir = path.posix.join(contentDirectory, directory);
  const paths = await globby(`${pathToDir}/*.md`);

  return Promise.all(paths.map((path) => read({ filepath: path, schema })));
}

export async function readBlog<T extends z.ZodTypeAny>({
  frontmatterSchema: schema,
}: {
  frontmatterSchema: T;
}) {
  const pathToDir = path.posix.join(contentDirectory, 'blog');
  const years = await fs.readdir(pathToDir, { withFileTypes: true});
  return Promise.all(years.filter(item => item.isDirectory()).map(async item => ({
    year: item.name,
    posts: await readAll({ directory: `blog/${item.name}`, frontmatterSchema: schema }),
  })));
}

export async function readTech<T extends z.ZodTypeAny>({
  frontmatterSchema: schema,
}: {
  frontmatterSchema: T;
}) {
  const pathToDir = path.posix.join(contentDirectory, 'tech');
  const years = await fs.readdir(pathToDir, { withFileTypes: true});
  return Promise.all(years.filter(item => item.isDirectory()).map(async item => ({
    year: item.name,
    posts: await readAll({ directory: `tech/${item.name}`, frontmatterSchema: schema }),
  })));
}
