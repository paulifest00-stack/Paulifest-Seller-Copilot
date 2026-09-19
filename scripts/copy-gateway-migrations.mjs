import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.resolve('src/gateway/database/migrations');
const destDir = path.resolve('dist-gateway/database/migrations');
const destDirNested = path.resolve('dist-gateway/gateway/database/migrations');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.mkdirSync(destDirNested, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    if (file.endsWith('.sql')) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      fs.copyFileSync(path.join(srcDir, file), path.join(destDirNested, file));
    }
  }
  console.log('✓ Migrações SQL copiadas para dist-gateway/database/migrations/ e dist-gateway/gateway/database/migrations/');
}
