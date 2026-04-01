import { tsImport } from 'tsx/esm/api';
import { workerData } from 'node:worker_threads';
await tsImport(workerData._workerTsPath, import.meta.url);
