import { expect, test, type Page } from '@playwright/test';

// One flow through the app, in a real browser, on an empty database: the super admin's first
// sign-in, a new tenant, its administrator's first sign-in, a customer and a file. Each test
// builds on the ones before.
test.describe.configure({ mode: 'serial' });

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

async function signOut(page: Page) {
  await page.getByRole('button', { name: /管理员|superadmin/ }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login/);
}

test('the super admin signs in with the initial password and replaces it', async ({ page }) => {
  await signIn(page, 'superadmin', initialPassword());
  await replacePassword(page, initialPassword(), SUPER_ADMIN_PASSWORD);
  await expect(page.getByRole('heading', { name: '租户管理' })).toBeVisible();
});

test('the super admin creates a tenant with a new administrator', async ({ page }) => {
  await signIn(page, 'superadmin', SUPER_ADMIN_PASSWORD);
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
});

test('the administrator signs in and lands on the workbench', async ({ page }) => {
  await signIn(page, 'smoke-admin', adminInitialPassword);
  await replacePassword(page, adminInitialPassword, ADMIN_PASSWORD);
  await expect(page.getByText('冒烟测试公司').first()).toBeVisible();
});

test('the administrator adds a customer', async ({ page }) => {
  await signIn(page, 'smoke-admin', ADMIN_PASSWORD);
  await page.goto('/crm/customers');
  await page.getByRole('button', { name: '新建客户' }).click();
  const dialog = page.getByRole('dialog', { name: '新建客户' });
  await dialog.getByLabel('客户名称').fill('冒烟客户');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: '冒烟客户' })).toBeVisible();
});

test('the administrator uploads a file', async ({ page }) => {
  await signIn(page, 'smoke-admin', ADMIN_PASSWORD);
  await page.goto('/files');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '上传' }).click();
  await (
    await chooser
  ).setFiles({ name: '冒烟.txt', mimeType: 'text/plain', buffer: Buffer.from('smoke') });
  await expect(page.getByRole('cell', { name: /冒烟\.txt/ }).first()).toBeVisible();
});

test('the administrator sees where they are signed in', async ({ page }) => {
  await signIn(page, 'smoke-admin', ADMIN_PASSWORD);
  await expect(page.getByText('冒烟测试公司').first()).toBeVisible();
  await page.getByRole('button', { name: '冒烟管理员' }).click();
  await page.getByRole('menuitem', { name: '登录设备' }).click();
  const dialog = page.getByRole('dialog', { name: '登录设备' });
  await expect(dialog.getByText('当前设备')).toBeVisible();
  await page.keyboard.press('Escape');
  await signOut(page);
});
