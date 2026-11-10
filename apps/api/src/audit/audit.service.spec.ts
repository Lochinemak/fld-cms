import { accountName, changesOf } from './audit.service.js';

describe('changesOf', () => {
  it('keeps the fields that changed, in words', () => {
    expect(
      changesOf([
        ['名称', '销售部', '市场部'],
        ['排序', 1, 1],
        ['端口', 25, 465],
        ['角色', ['销售', '经理'], ['销售']],
        ['负责人', ['张三'], ['张三']],
        ['上级部门', null, ''],
        ['自定义部门', [], undefined],
        ['邮箱', undefined, 'a@fld.test'],
      ]),
    ).toEqual([
      { field: '名称', from: '销售部', to: '市场部' },
      { field: '端口', from: '25', to: '465' },
      { field: '角色', from: '销售、经理', to: '销售' },
      { field: '邮箱', from: null, to: 'a@fld.test' },
    ]);
  });
});

describe('accountName', () => {
  it('gives the name with the username', () => {
    expect(accountName({ username: 'zhangsan', displayName: '张三' })).toBe('张三（zhangsan）');
  });
});
