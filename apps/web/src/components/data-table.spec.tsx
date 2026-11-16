import type { TablePreference } from '@fld/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ColumnsMenu, DataTable } from './data-table';
import { useTableView, type DataColumn } from '@/lib/table-view';
import { renderWithQuery, stubApi } from '@/test/render';

interface Fruit {
  id: string;
  name: string;
  color: string;
  origin: string;
}

const FRUITS: Fruit[] = [
  { id: '1', name: '苹果', color: '红', origin: '烟台' },
  { id: '2', name: '香蕉', color: '黄', origin: '海南' },
];

const COLUMNS: DataColumn<Fruit, 'name' | 'color'>[] = [
  { id: 'name', header: '名称', hideable: false, sortBy: 'name', cell: (fruit) => fruit.name },
  { id: 'color', header: '颜色', sortBy: 'color', cell: (fruit) => fruit.color },
  { id: 'origin', header: '产地', defaultHidden: true, cell: (fruit) => fruit.origin },
];

const PATH = '/api/preferences/tables/crm.customer';

function FruitTable({ actions = false, rows = FRUITS }: { actions?: boolean; rows?: Fruit[] }) {
  const view = useTableView('crm.customer', COLUMNS);
  return (
    <>
      <ColumnsMenu view={view} />
      <output data-testid="sort">{JSON.stringify(view.sort ?? null)}</output>
      <DataTable
        view={view}
        rows={view.ready ? rows : undefined}
        rowKey={(fruit) => fruit.id}
        isPending={!view.ready}
        empty="没有水果"
        actions={actions ? (fruit) => <button type="button">吃掉{fruit.name}</button> : undefined}
      />
    </>
  );
}

/** The API with one saved preference, which PUT replaces. */
function stubPreference(saved: TablePreference = { columns: {}, sort: null }) {
  let current = saved;
  return stubApi({
    [`GET ${PATH}`]: () => current,
    [`PUT ${PATH}`]: ({ json }) => (current = json as TablePreference),
  });
}

const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent);
const saves = (requests: ReturnType<typeof stubApi>) =>
  requests.filter(({ method }) => method === 'PUT').map(({ json }) => json);

describe('DataTable', () => {
  it('shows the default columns to a member who never chose', async () => {
    stubPreference();
    renderWithQuery(<FruitTable />);

    expect(screen.getByText('加载中…')).toBeInTheDocument();
    expect(await screen.findByText('苹果')).toBeInTheDocument();
    expect(headers()).toEqual(['名称', '颜色']);
    expect(screen.queryByText('烟台')).not.toBeInTheDocument();
  });

  it('shows the columns the member saved', async () => {
    stubPreference({ columns: { color: false, origin: true }, sort: null });
    renderWithQuery(<FruitTable />);

    expect(await screen.findByText('烟台')).toBeInTheDocument();
    expect(headers()).toEqual(['名称', '产地']);
  });

  it('falls back to the defaults when the preference cannot be read', async () => {
    stubApi({
      [`GET ${PATH}`]: () => {
        throw Response.json({ message: '出错了' }, { status: 500 });
      },
    });
    renderWithQuery(<FruitTable />);

    expect(await screen.findByText('苹果')).toBeInTheDocument();
    expect(headers()).toEqual(['名称', '颜色']);
  });

  it('says so when there is nothing to list, across every column', async () => {
    stubPreference();
    renderWithQuery(<FruitTable actions rows={[]} />);

    const message = await screen.findByRole('cell', { name: '没有水果' });
    expect(message).toHaveAttribute('colspan', '3');
  });

  it('ends each row with its actions when there are any', async () => {
    stubPreference();
    renderWithQuery(<FruitTable actions />);

    expect(await screen.findByRole('button', { name: '吃掉苹果' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });

  it('sorts by a column on a click of its header, then turns around, then stops', async () => {
    const requests = stubPreference();
    const user = userEvent.setup();
    renderWithQuery(<FruitTable />);
    const color = await screen.findByRole('columnheader', { name: /颜色/ });
    expect(color).toHaveAttribute('aria-sort', 'none');

    await user.click(within(color).getByRole('button'));
    expect(color).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByTestId('sort')).toHaveTextContent('{"sort":"color","order":"asc"}');

    await user.click(within(color).getByRole('button'));
    expect(color).toHaveAttribute('aria-sort', 'descending');

    await user.click(within(color).getByRole('button'));
    expect(color).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByTestId('sort')).toHaveTextContent('null');

    await waitFor(() =>
      expect(saves(requests)).toEqual([
        { columns: {}, sort: { column: 'color', order: 'asc' } },
        { columns: {}, sort: { column: 'color', order: 'desc' } },
        { columns: {}, sort: null },
      ]),
    );
  });

  it('gives no sort button to a column the API cannot sort by', async () => {
    stubPreference({ columns: { origin: true }, sort: null });
    renderWithQuery(<FruitTable />);

    const origin = await screen.findByRole('columnheader', { name: '产地' });
    expect(within(origin).queryByRole('button')).not.toBeInTheDocument();
    expect(origin).not.toHaveAttribute('aria-sort');
  });
});

describe('ColumnsMenu', () => {
  it('lists the columns that can be hidden, ticked as shown', async () => {
    stubPreference();
    const user = userEvent.setup();
    renderWithQuery(<FruitTable />);
    await screen.findByText('苹果');

    await user.click(screen.getByRole('button', { name: '列' }));
    const items = await screen.findAllByRole('menuitemcheckbox');
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['颜色', 'true'],
      ['产地', 'false'],
    ]);
    expect(screen.getByRole('menuitem', { name: '恢复默认' })).toHaveAttribute('aria-disabled');
  });

  it('hides and shows columns at once, and saves the choice', async () => {
    const requests = stubPreference();
    const user = userEvent.setup();
    renderWithQuery(<FruitTable />);
    await screen.findByText('苹果');

    await user.click(screen.getByRole('button', { name: '列' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: '颜色' }));
    await waitFor(() => expect(headers()).toEqual(['名称']));
    // The menu stays open for the next choice.
    await user.click(screen.getByRole('menuitemcheckbox', { name: '产地' }));
    await waitFor(() => expect(headers()).toEqual(['名称', '产地']));

    await waitFor(() =>
      expect(saves(requests)).toEqual([
        { columns: { color: false }, sort: null },
        { columns: { color: false, origin: true }, sort: null },
      ]),
    );
  });

  it('goes back to the defaults', async () => {
    const requests = stubPreference({
      columns: { color: false },
      sort: { column: 'name', order: 'desc' },
    });
    const user = userEvent.setup();
    renderWithQuery(<FruitTable />);
    await screen.findByText('苹果');
    expect(headers()).toEqual(['名称']);

    await user.click(screen.getByRole('button', { name: '列' }));
    await user.click(await screen.findByRole('menuitem', { name: '恢复默认' }));

    await waitFor(() => expect(headers()).toEqual(['名称', '颜色']));
    expect(screen.getByTestId('sort')).toHaveTextContent('null');
    await waitFor(() => expect(saves(requests)).toEqual([{ columns: {}, sort: null }]));
  });

  it('undoes a choice the server refused', async () => {
    const requests = stubApi({
      [`GET ${PATH}`]: () => ({ columns: {}, sort: null }),
      [`PUT ${PATH}`]: () => {
        throw Response.json({ message: '出错了' }, { status: 500 });
      },
    });
    const user = userEvent.setup();
    renderWithQuery(<FruitTable />);
    await screen.findByText('苹果');

    await user.click(screen.getByRole('button', { name: '列' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: '颜色' }));

    // Hidden at once, back once the save failed and the saved preference was read again.
    await waitFor(() => expect(requests.filter(({ method }) => method === 'GET')).toHaveLength(2));
    await waitFor(() => expect(headers()).toEqual(['名称', '颜色']));
    expect(saves(requests)).toEqual([{ columns: { color: false }, sort: null }]);
  });
});
