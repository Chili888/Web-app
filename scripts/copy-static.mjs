import {cp, mkdir} from "node:fs/promises";

const root = new URL("../", import.meta.url);
const target = new URL("../dist/static/", import.meta.url);

await mkdir(target, {recursive: true});
for (const path of ["index.html", "config.js", "assets", "admin", "后台配置说明.md"]) {
  await cp(new URL(path, root), new URL(path, target), {recursive: true});
}
