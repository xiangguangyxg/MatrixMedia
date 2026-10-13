require('@babel/register')({extensions:['.js'],ignore:[/node_modules/]});
const assert=require('assert');
const {parsePublishRequest,parsePublishArgs}=require('../src/main/cli/parsePublishArgs');
const body={platform:'blbl',phone:'test',file:'fixture.mp4',title:'测试',blblCategory:'知识'};
assert.equal(parsePublishRequest(body).value.publishOptions.category,'知识');
assert.equal(parsePublishArgs(['-p','blbl','--phone','test','-f','fixture.mp4','-t','测试','--blbl-category','知识']).value.publishOptions.category,'知识');
assert.equal(parsePublishArgs(['-p','blbl','--phone','test','-f','fixture.mp4','-t','测试','--blbl-category']).ok,false);
assert.equal(parsePublishRequest({...body,platform:'dy'}).ok,false);
console.log('test-blbl-category-args passed');
