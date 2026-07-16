import {rm} from "node:fs/promises";

await rm(new URL("../dist-test", import.meta.url), {recursive: true, force: true});
