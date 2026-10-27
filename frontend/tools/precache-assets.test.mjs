import { expect, it } from 'vitest';
import { precacheAssets } from './precache-assets.mjs';
const chunk=(imports=[],dynamicImports=[],extra={})=>({type:'chunk',imports,dynamicImports,...extra});
const bundle=()=>({
 'app.js':chunk(['react.js'],['breadth.js','server.js'],{isEntry:true}),
 'react.js':chunk(),
 'breadth.js':chunk(['charts.js'],['groups.js']),
 'groups.js':chunk(['charts.js']),
 'charts.js':chunk(['react.js']),
 'server.js':chunk(['react.js','backend.js'],['admin.js'],{facadeModuleId:'C:\\repo\\src\\ServerApp.jsx'}),
 'backend.js':chunk(), 'admin.js':chunk(), 'styles.css':{type:'asset'}, 'mascot.webp':{type:'asset'},
});
it('precaches every static lazy route and shared library but not the backend graph',()=>{
 expect(precacheAssets(bundle(),{staticSite:true})).toEqual(['app.js','react.js','breadth.js','groups.js','charts.js','styles.css','mascot.webp']);
});
it('retains backend-shared chunks that a static route actually imports',()=>{
 const input=bundle();input['groups.js'].imports.push('backend.js');expect(precacheAssets(input,{staticSite:true})).toContain('backend.js');
});
it('recognizes merged dynamic entries whose Rollup facade is null',()=>{
 const input=bundle();input['server.js'].facadeModuleId=null;
 input['server.js'].moduleIds=['C:/repo/src/backend.jsx','C:/repo/src/ServerApp.jsx'];
 expect(precacheAssets(input,{staticSite:true})).not.toContain('server.js');
 expect(precacheAssets(input,{staticSite:true})).toContain('groups.js');
});
it('preserves the entire existing manifest for connected builds',()=>{expect(precacheAssets(bundle())).toEqual(Object.keys(bundle()));});
it('rejects incomplete build graphs instead of silently omitting an offline route',()=>{
 const input=bundle();delete input['breadth.js'];expect(()=>precacheAssets(input,{staticSite:true})).toThrow('Unknown dynamic');
 expect(()=>precacheAssets({}, {staticSite:true})).toThrow('entry chunk');
});
