import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme, type Theme } from '@/components/theme-provider';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from 'react-i18next';

const THEMES = [
  { value: 'light', label: 'themeLight', Icon: Sun },
  { value: 'dark', label: 'themeDark', Icon: Moon },
  { value: 'system', label: 'themeSystem', Icon: Monitor },
] as const satisfies readonly { value: Theme; label: string; Icon: LucideIcon }[];

export function ThemeMenu() {
  const { t } = useTranslation('layout');
  const { theme, setTheme } = useTheme();
  const CurrentIcon = (THEMES.find((option) => option.value === theme) ?? THEMES[2]).Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        aria-label={t('appearance')}
        title={t('appearance')}
      >
        <CurrentIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-32">
        <DropdownMenuRadioGroup value={theme} onValueChange={(value: Theme) => setTheme(value)}>
          {THEMES.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {t(label)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
