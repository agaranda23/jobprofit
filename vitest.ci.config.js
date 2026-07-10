import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config.js';

// CI-only test config. Extends vitest.config.js (same environment, setup,
// coverage — nothing about local `npm run test` changes).
//
// This used to carry a 7-file exclude list for pre-existing failures. All
// seven were fixed in fix/test-suite-full-green (2026-07): three were a
// missing `navigator` global (jsdom pragma / shim), two were an ICU
// punctuation difference between Node 20 and Node 22 in due-date
// assertions, and two were CRLF line-ending artifacts from Windows
// `core.autocrlf=true` checkouts breaking `\n`-anchored CSS-block markers
// (the underlying CSS never drifted). If a file ever needs excluding again,
// re-add the array here with a dated TODO comment explaining why.
export default mergeConfig(baseConfig, defineConfig({}));
