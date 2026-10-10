// How much one call may carry. Chosen against a big repository, not a small
// one: 4 000 files and 10 000 edges is about 21 write calls at this size.
//
//   BATCH      Rows written (or deleted) per mutation. A file row is about
//              300 bytes, an edge row about 250, so a call of 500 is ~150 KB:
//              under 1 % of the 16 MiB a call may carry and 3 % of the 16 000
//              documents it may write, with room for the 1-second limit on a
//              mutation. Larger would be fewer calls but nearer every ceiling;
//              smaller would mean hundreds of round trips for no safety gain.
//
//   READ_PAGE  Rows per page when the explorer loads an analysis. Reads carry
//              less than writes, so a page may be larger; 4 000 files load in
//              two pages and 10 000 edges in five.
export const BATCH = 500;
export const READ_PAGE = 2000;
