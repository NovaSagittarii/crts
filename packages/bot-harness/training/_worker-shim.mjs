import { workerData } from 'node:worker_threads';
import { tsImport } from 'tsx/esm/api';

await tsImport(workerData._workerTsPath, import.meta.url);
