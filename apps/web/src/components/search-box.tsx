import { Search } from 'lucide-react';
import type { FormEvent } from 'react';
import { Input } from '@/components/ui/input';

interface SearchBoxProps {
  value: string | undefined;
  placeholder: string;
  /** On Enter; an empty box clears the search. */
  onSearch: (keyword: string | undefined) => void;
}

export function SearchBox({ value, placeholder, onSearch }: SearchBoxProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = new FormData(event.currentTarget).get('keyword');
    onSearch(typeof keyword === 'string' && keyword.trim() ? keyword.trim() : undefined);
  }

  return (
    // Remounts when the address changes the keyword, say on going back.
    <form key={value} role="search" onSubmit={handleSubmit} className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        name="keyword"
        type="search"
        defaultValue={value}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
      />
    </form>
  );
}
