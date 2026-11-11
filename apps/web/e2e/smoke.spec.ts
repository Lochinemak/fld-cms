import { expect, test, type Page } from '@playwright/test';
import { totp } from './totp.js';

// One flow through the app, in a real browser, on an empty database: the super admin's first
// sign-in, a new tenant, its administrator's first sign-in, a customer, a file and two-step
// sign-in. Each test builds on the ones before, in one browser tab: signing in again for each
// would run into the limit of 5 sign-ins per account in 15 minutes.
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});

test.afterAll(async () => {
  await page.close();
});

const SUPER_ADMIN_PASSWORD = 'smoke-super-password-1';
const ADMIN_PASSWORD = 'smoke-admin-password-1';

/** Taken from the API's log by playwright.config.ts. */
const initialPassword = () => {
  const password = process.env['SUPERADMIN_PASSWORD'];
  if (!password) {
    throw new Error('The API did not log the initial password: is the database empty?');
  }
  return password;
};

let adminInitialPassword = '';

async function signIn(page: Page, account: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill(account);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Replaces the initial password, as the first sign-in must. */
async function replacePassword(page: Page, current: string, next: string) {
  await expect(page.getByText('修改后才能继续使用')).toBeVisible();
  await page.getByLabel('当前密码').fill(current);
  await page.getByLabel('新密码', { exact: true }).fill(next);
  await page.getByLabel('确认新密码').fill(next);
  await page.getByRole('button', { name: '保存新密码' }).click();
}

/** Signs out through the menu under the user's name. */
async function signOut(page: Page, displayName: string) {
  await page.getByRole('button', { name: displayName, exact: true }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login/);
}

test('the super admin signs in with the initial password and replaces it', async () => {
  await signIn(page, 'superadmin', initialPassword());
  await replacePassword(page, initialPassword(), SUPER_ADMIN_PASSWORD);
  await expect(page.getByRole('heading', { name: '租户管理' })).toBeVisible();
});

test('the super admin creates a tenant with a new administrator', async () => {
  await page.getByRole('button', { name: '新建租户' }).click();
  const dialog = page.getByRole('dialog', { name: '新建租户' });
  await dialog.getByLabel('租户编码').fill('smoke');
  await dialog.getByLabel('租户名称').fill('冒烟测试公司');
  await dialog.getByRole('radio', { name: '新建账号' }).click();
  await dialog.getByLabel('用户名', { exact: true }).fill('smoke-admin');
  await dialog.getByLabel('姓名').fill('冒烟管理员');
  await dialog.getByRole('button', { name: '创建' }).click();

  const secret = page.getByRole('dialog', { name: /已创建/ });
  adminInitialPassword = (await secret.locator('code').textContent()) ?? '';
  expect(adminInitialPassword).not.toBe('');
  await secret.getByRole('button', { name: '我已记下' }).click();
  await expect(page.getByRole('cell', { name: '冒烟测试公司' })).toBeVisible();
  await signOut(page, '超级管理员');
});

test('the administrator signs in and lands on the workbench', async () => {
  await signIn(page, 'smoke-admin', adminInitialPassword);
  await replacePassword(page, adminInitialPassword, ADMIN_PASSWORD);
  await expect(page.getByText('冒烟测试公司').first()).toBeVisible();
});

test('the administrator adds a customer', async () => {
  await page.goto('/crm/customers');
  await page.getByRole('button', { name: '新建客户' }).click();
  const dialog = page.getByRole('dialog', { name: '新建客户' });
  await dialog.getByLabel('客户名称').fill('冒烟客户');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: '冒烟客户' })).toBeVisible();
});

test('the administrator uploads a file', async () => {
  await page.goto('/files');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '上传' }).click();
  await (
    await chooser
  ).setFiles({ name: '冒烟.txt', mimeType: 'text/plain', buffer: Buffer.from('smoke') });
  await expect(page.getByRole('cell', { name: /冒烟\.txt/ }).first()).toBeVisible();
});

test('the administrator adds a field to customers, and fills it in', async () => {
  const submit = (scope: ReturnType<Page['getByRole']>) =>
    scope.getByRole('button', { name: /^(保存|创建)$/ }).click();

  await page.goto('/system/dictionaries');
  await page.getByRole('button', { name: '新建字典' }).click();
  const create = page.getByRole('dialog', { name: '新建字典' });
  await create.getByLabel('编码').fill('region');
  await create.getByLabel('名称').fill('区域');
  await submit(create);
  await expect(create).toBeHidden();
  await page.getByText('区域', { exact: true }).first().click();
  for (const label of ['华东', '华南']) {
    await page.getByRole('button', { name: '新增选项' }).click();
    const item = page.getByRole('dialog', { name: /新增选项/ });
    await item.getByLabel('名称').fill(label);
    await submit(item);
    await expect(item).toBeHidden();
  }
  await expect(page.getByRole('cell', { name: '华南' })).toBeVisible();

  await page.goto('/system/custom-fields');
  await page.getByRole('button', { name: '新增字段' }).click();
  const field = page.getByRole('dialog', { name: /新增字段/ });
  await field.getByLabel('字段标识').fill('region');
  await field.getByLabel('字段名称').fill('区域');
  await field.getByRole('combobox', { name: '类型' }).click();
  await page.getByRole('option', { name: '单选' }).click();
  await field.getByRole('combobox', { name: '数据字典' }).click();
  await page.getByRole('option', { name: '区域' }).click();
  await field.getByText('必填', { exact: true }).click();
  await field.getByText('在列表中显示', { exact: true }).click();
  await submit(field);
  await expect(field).toBeHidden();
  await expect(page.getByRole('cell', { name: 'region' })).toBeVisible();

  // A yes/no field needs no dictionary: it is a switch.
  await page.getByRole('button', { name: '新增字段' }).click();
  const vip = page.getByRole('dialog', { name: /新增字段/ });
  await expect(vip.getByText(/填一行文字/)).toBeVisible();
  await vip.getByLabel('字段标识').fill('vip');
  await vip.getByLabel('字段名称').fill('VIP');
  await vip.getByRole('combobox', { name: '类型' }).click();
  await page.getByRole('option', { name: '是/否' }).click();
  await expect(vip.getByText(/一个开关/)).toBeVisible();
  await expect(vip.getByRole('combobox', { name: '数据字典' })).toHaveCount(0);
  await vip.getByText('在列表中显示', { exact: true }).click();
  await submit(vip);
  await expect(vip).toBeHidden();

  await page.goto('/crm/customers');
  await page.getByRole('button', { name: '新建客户' }).click();
  const customer = page.getByRole('dialog', { name: '新建客户' });
  await customer.getByLabel('客户名称').fill('带字段的客户');
  await customer.getByRole('button', { name: '保存' }).click();
  await expect(customer.getByText('请填写区域')).toBeVisible();
  await customer.getByRole('combobox', { name: '区域 *' }).click();
  await page.getByRole('option', { name: '华东' }).click();
  await customer.getByRole('switch', { name: 'VIP' }).click();
  await customer.getByRole('button', { name: '保存' }).click();
  await expect(customer).toBeHidden();
  await expect(page.getByRole('columnheader', { name: '区域' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '华东' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'VIP' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '是', exact: true })).toBeVisible();
});

test('the administrator sees where they are signed in', async () => {
  await page.getByRole('button', { name: '冒烟管理员' }).click();
  await page.getByRole('menuitem', { name: '登录设备' }).click();
  const dialog = page.getByRole('dialog', { name: '登录设备' });
  await expect(dialog.getByText('当前设备')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the administrator turns on two-step sign-in, and signs in with a code', async () => {
  await page.getByRole('button', { name: '冒烟管理员' }).click();
  await page.getByRole('menuitem', { name: '两步验证' }).click();
  const dialog = page.getByRole('dialog', { name: '两步验证' });
  await dialog.getByRole('button', { name: '开启两步验证' }).click();
  await dialog.getByLabel('当前密码').fill(ADMIN_PASSWORD);
  await dialog.getByRole('button', { name: '下一步' }).click();
  await expect(dialog.getByRole('img', { name: '两步验证的二维码' })).toBeVisible();
  const secret = (await dialog.locator('p.font-mono').textContent())!.trim();
  await dialog.getByLabel('验证码').fill(totp(secret, -1));
  await dialog.getByRole('button', { name: '开启' }).click();
  await expect(dialog.getByText('这些恢复码只显示这一次')).toBeVisible();
  await dialog.getByRole('button', { name: '我已保存' }).click();
  await expect(dialog).toBeHidden();
  await signOut(page, '冒烟管理员');

  await signIn(page, 'smoke-admin', ADMIN_PASSWORD);
  await expect(page).toHaveURL(/\/verify-mfa/);
  await page.getByLabel('验证码').fill(totp(secret));
  await page.getByRole('button', { name: '验证' }).click();
  await expect(page.getByText('冒烟测试公司').first()).toBeVisible();
});
