#!/usr/bin/env node
import { main } from '../src/cli.js';

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((err) => {
    console.error(`devrailsv2: ${err.message}`);
    if (process.env.DEVRAILS_DEBUG) console.error(err.stack);
    process.exitCode = 1;
  });
