/**
 * S3-I CO-2 — print the run header, then exit (or, when used as `node --import`, leave the
 * process running so test:s1 / test:focused can start). Loaded before TAP so it is line 1.
 */
import { printRunHeader } from "./skip-summary.mjs";
printRunHeader();
