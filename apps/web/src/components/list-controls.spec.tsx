import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaginationBar } from './pagination-bar';
import { SearchBox } from './search-box';

describe('PaginationBar', () => {
  it('counts the rows and pages, and moves between pages', async () => {
    const onPageChange = vi.fn();
    const user = userEvent.setup();
    render(<PaginationBar page={2} pageSize={20} total={45} onPageChange={onPageChange} />);

    expect(screen.getByText('共 45 条')).toBeInTheDocument();
    expect(screen.getByText('第 2 / 3 页')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '上一页' }));
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(onPageChange.mock.calls).toEqual([[1], [3]]);
  });

  it('stops at the first and the last page', () => {
    const { rerender } = render(
      <PaginationBar page={1} pageSize={20} total={45} onPageChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled();

    rerender(<PaginationBar page={3} pageSize={20} total={45} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });

  it('shows one page for an empty list, and its own summary when given one', () => {
    render(
      <PaginationBar page={1} pageSize={20} total={0} summary="没有记录" onPageChange={() => {}} />,
    );
    expect(screen.getByText('没有记录')).toBeInTheDocument();
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });

  it('goes to the last page when the one shown no longer exists', () => {
    const onPageChange = vi.fn();
    render(<PaginationBar page={5} pageSize={20} total={45} onPageChange={onPageChange} />);
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});

describe('SearchBox', () => {
  it('searches on Enter, without the spaces around the keyword', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchBox value={undefined} placeholder="搜索客户" onSearch={onSearch} />);

    await user.type(screen.getByRole('searchbox', { name: '搜索客户' }), '  华东 {Enter}');
    expect(onSearch).toHaveBeenCalledWith('华东');
  });

  it('clears the search when the box is emptied', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchBox value="华东" placeholder="搜索客户" onSearch={onSearch} />);

    const box = screen.getByRole('searchbox', { name: '搜索客户' });
    expect(box).toHaveValue('华东');
    await user.clear(box);
    await user.type(box, '{Enter}');
    expect(onSearch).toHaveBeenCalledWith(undefined);
  });
});
