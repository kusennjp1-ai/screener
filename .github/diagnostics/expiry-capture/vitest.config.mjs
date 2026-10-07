import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const dir=fileURLToPath(new URL('.',import.meta.url));
const frontend=process.env.SCREENER_FRONTEND || fileURLToPath(new URL('../screener-schedule-fixture-fix/frontend/',import.meta.url));
export default defineConfig({root:dir,plugins:[react()],resolve:{alias:[{find:'@ui',replacement:`${frontend}/src/static`},{find:/^@mui\/icons-material\/(?!esm(?:\/|$))([^/]+)$/,replacement:'@mui/icons-material/esm/$1'}]},test:{environment:'jsdom',globals:true,setupFiles:[`${frontend}/src/test/setup.js`],include:['*.test.{jsx,mjs}'],maxWorkers:2,minWorkers:1,testTimeout:20000,hookTimeout:20000}});
