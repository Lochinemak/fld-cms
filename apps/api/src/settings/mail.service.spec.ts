import { renderMailTemplate } from '@fld/shared';
import { toHtml } from './mail.service.js';

describe('renderMailTemplate', () => {
  it('fills the placeholders it has values for, and leaves the others', () => {
    expect(
      renderMailTemplate('{{姓名}}，你好：{{ 用户名 }} {{未知}} {{姓名}}', {
        姓名: '张三',
        用户名: 'zhangsan',
      }),
    ).toBe('张三，你好：zhangsan {{未知}} 张三');
  });

  it('takes values as they are, without filling placeholders inside them', () => {
    expect(renderMailTemplate('{{a}} {{b}}', { a: '{{b}} $&', b: 'B' })).toBe('{{b}} $& B');
  });
});

describe('toHtml', () => {
  it('escapes the text, and keeps its line breaks and links', () => {
    const html = toHtml(
      '<b>你好</b> & "再见"\n打开 https://crm.example.com/reset-password?token=a_b-c 设置',
    );

    expect(html).toContain('&lt;b&gt;你好&lt;/b&gt; &amp; &quot;再见&quot;<br>打开 ');
    expect(html).toContain(
      '<a href="https://crm.example.com/reset-password?token=a_b-c" style="color:#2563eb">https://crm.example.com/reset-password?token=a_b-c</a> 设置',
    );
    expect(html).not.toContain('<b>');
  });

  it('keeps a quote from ending the link early', () => {
    expect(toHtml('https://x.example/?q="><script>')).toContain(
      '<a href="https://x.example/?q=" style="color:#2563eb">https://x.example/?q=</a>&quot;&gt;&lt;script&gt;',
    );
  });
});
