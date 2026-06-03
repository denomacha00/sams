import { createRequire } from 'module';

const nodeRequire = createRequire(__filename);
nodeRequire('../../bin/load-env-from-file').loadEnvFromFile();
