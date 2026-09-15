#!/usr/bin/env node
import { runCli } from "./revalidate-key.js";

const result = runCli(process.argv.slice(2), process.env);
if (result.out) console.log(result.out);
if (result.err) console.error(result.err);
process.exitCode = result.code;
