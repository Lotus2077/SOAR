import { tsImport } from "tsx/esm/api";

await tsImport(
  new URL("./budget-reservation-worker.ts", import.meta.url).href,
  import.meta.url,
);
