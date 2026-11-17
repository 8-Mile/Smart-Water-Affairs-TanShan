import { build } from 'esbuild';
await build({entryPoints:['src/main.ts'],bundle:true,platform:'node',target:'node22',format:'esm',outfile:'dist/main.js',sourcemap:true,external:['@nestjs/*','@electric-sql/pglite','reflect-metadata','rxjs','zod'],tsconfig:'tsconfig.json'});
