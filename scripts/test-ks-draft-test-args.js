const assert=require('assert');require('@babel/register')({extensions:['.js'],ignore:[/node_modules/]});const {parsePublishArgs}=require('../src/main/cli/parsePublishArgs');
const base=['-p','ks','--phone','fixture-account','-f','fixture.mp4','-t','测试'];
const test=parsePublishArgs([...base,'--draft-test']);assert.equal(test.ok,true);assert.equal(test.value.draft,true);assert.equal(test.value.publishOptions.discardVerifiedDraft,true);
assert.equal(parsePublishArgs([...base.slice(0,1),'sph',...base.slice(2),'--draft-test']).ok,false);
console.log('test-ks-draft-test-args passed');
