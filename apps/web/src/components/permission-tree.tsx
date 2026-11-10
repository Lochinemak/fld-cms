import { PERMISSION_CODES, permissionDefinition, type PermissionCode } from '@fld/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface PermissionTreeProps {
  /** The codes a role may hold in this tenant. */
  codes: readonly PermissionCode[];
  value: ReadonlySet<PermissionCode>;
  onChange: (next: Set<PermissionCode>) => void;
  /** Whether the user may tick or untick the code; nobody grants what they don't hold. */
  canChange: (code: PermissionCode) => boolean;
  disabled?: boolean;
}

const DIRECTORIES = PERMISSION_CODES.filter(
  (code) => permissionDefinition(code).kind === 'directory',
);

/**
 * Directory → page → element checkboxes. An element is no use without its page, so ticking it
 * ticks the page too, and unticking a page unticks its elements.
 */
export function PermissionTree({
  codes,
  value,
  onChange,
  canChange,
  disabled = false,
}: PermissionTreeProps) {
  const childrenOf = (parent: PermissionCode) =>
    codes.filter((code) => permissionDefinition(code).parent === parent);

  function update(add: readonly PermissionCode[], remove: readonly PermissionCode[]) {
    const next = new Set(value);
    for (const code of remove) {
      if (canChange(code)) {
        next.delete(code);
      }
    }
    for (const code of add) {
      if (canChange(code)) {
        next.add(code);
      }
    }
    onChange(next);
  }

  return (
    <div className="space-y-4">
      {DIRECTORIES.map((directory) => {
        const pages = childrenOf(directory);
        if (pages.length === 0) {
          return null;
        }
        const all = pages.flatMap((page) => [page, ...childrenOf(page)]);
        const held = all.filter((code) => value.has(code)).length;
        return (
          <div key={directory} className="space-y-2">
            <Label>
              <Checkbox
                checked={held === all.length}
                indeterminate={held > 0 && held < all.length}
                disabled={disabled}
                onCheckedChange={(checked) => (checked ? update(all, []) : update([], all))}
              />
              {permissionDefinition(directory).name}
            </Label>
            <div className="ml-6 divide-y rounded-lg border">
              {pages.map((page) => {
                const elements = childrenOf(page);
                return (
                  <div key={page} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
                    <Label className="w-28 shrink-0">
                      <Checkbox
                        checked={value.has(page)}
                        disabled={disabled || !canChange(page)}
                        onCheckedChange={(checked) =>
                          checked ? update([page], []) : update([], [page, ...elements])
                        }
                      />
                      {permissionDefinition(page).name}
                    </Label>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {elements.map((element) => (
                        <Label key={element} className="font-normal">
                          <Checkbox
                            checked={value.has(element)}
                            disabled={disabled || !canChange(element)}
                            onCheckedChange={(checked) =>
                              checked ? update([page, element], []) : update([], [element])
                            }
                          />
                          {permissionDefinition(element).name}
                        </Label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
