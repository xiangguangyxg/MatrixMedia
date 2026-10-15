const assert=require('assert'),path=require('path'),fs=require('fs');const {build}=require('esbuild');
(async()=>{
 const root=path.resolve(__dirname,'..'),outfile=path.join(root,'test/.cache/original-api.cjs');fs.mkdirSync(path.dirname(outfile),{recursive:true});
 await build({entryPoints:[path.join(root,'src/main/cli/parsePublishArgs.js')],outfile,bundle:true,platform:'node',format:'cjs'});
 const {parsePublishRequest,parseMultiPublishRequest}=require(outfile);
 const base={platform:'dy',phone:'Tachyon',file:'fixture.mp4',title:'原创资格测试',creativeStatement:'ai_generated'};
 const review={eligible:true,reason:'independent work reviewed',platform:'dy',fileSha256:'a'.repeat(64),evidence:['fixture.json']};
 let result=parsePublishRequest({...base,originalDeclaration:review});assert.equal(result.ok,true);assert.deepEqual(result.value.publishOptions.originalDeclaration,review);assert.equal(result.value.creativeStatement,'ai_generated');
 for(const value of [true,'true',{eligible:true},{...review,platform:'ks'}])assert.equal(parsePublishRequest({...base,originalDeclaration:value}).ok,false);
 result=parsePublishRequest({...base,originalDeclaration:{eligible:false,reason:'not original'}});assert.equal(result.value.publishOptions.originalDeclaration.eligible,false);
 result=parseMultiPublishRequest({...base,platform:undefined,platforms:[{platform:'dy',originalDeclaration:review},{platform:'ks',originalDeclaration:{eligible:false,reason:'unreviewed'}}]});assert.equal(result.ok,true);
 const list=result.value.items||result.value;assert.equal(Array.isArray(list),true);assert.equal(list[0].publishOptions.originalDeclaration.eligible,true);assert.equal(list[1].publishOptions.originalDeclaration.eligible,false);
 console.log('PASS original review HTTP parsing, invalid input, AI preservation and per-platform overrides');
})().catch(e=>{console.error(e);process.exitCode=1});
