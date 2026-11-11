import { permissionDefinition, type PermissionCode } from '@fld/shared';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { zhCN } from './locales/zh-CN';

/** Strings in place of the Chinese ones, key for key, for another language to fill in. */
export type Translation = {
  [Namespace in keyof typeof zhCN]: { [Key in keyof (typeof zhCN)[Namespace]]: string };
};

/**
 * Names of permissions, which also title the menu, by code. A code left out shows the name the
 * registry in @fld/shared gives it, which is Chinese: Chinese needs no entries.
 */
export type PermissionNames = Partial<Record<PermissionCode, string>>;

/**
 * The languages the interface comes in, by BCP 47 tag, each named in itself. Add one with a
 * `Translation` of every key: the language menu appears once there are two.
 */
export const LANGUAGES = {
  'zh-CN': { name: '简体中文', translation: zhCN, permissions: {} },
} satisfies Record<
  string,
  { name: string; translation: Translation; permissions: PermissionNames }
>;
export type Language = keyof typeof LANGUAGES;

const DEFAULT_LANGUAGE: Language = 'zh-CN';
const STORAGE_KEY = 'fld-language';

const isLanguage = (value: string | null): value is Language =>
  value !== null && Object.hasOwn(LANGUAGES, value);

/** The language saved in this browser, else the first of the browser's own we have, else Chinese. */
function initialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (isLanguage(saved)) {
    return saved;
  }
  const tags = Object.keys(LANGUAGES) as Language[];
  for (const wanted of navigator.languages) {
    const match =
      tags.find((tag) => tag.toLowerCase() === wanted.toLowerCase()) ??
      tags.find((tag) => tag.split('-')[0] === wanted.split('-')[0]);
    if (match) {
      return match;
    }
  }
  return DEFAULT_LANGUAGE;
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(
    Object.entries(LANGUAGES).map(([tag, language]) => [
      tag,
      { ...language.translation, permissions: language.permissions },
    ]),
  ),
  lng: initialLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: 'common',
  ns: [...Object.keys(zhCN), 'permissions'],
  // React escapes what it renders.
  interpolation: { escapeValue: false },
  // Everything is bundled: nothing to wait for.
  react: { useSuspense: false },
});

document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

/** Switches the interface to the language, and keeps it for this browser. */
export async function changeLanguage(language: Language): Promise<void> {
  localStorage.setItem(STORAGE_KEY, language);
  await i18n.changeLanguage(language);
}

/** The current language's tag, for dates and numbers. */
export const currentLocale = (): string => i18n.language || DEFAULT_LANGUAGE;

/** A permission's name, which also titles its menu item, in the current language. */
export function permissionName(code: PermissionCode): string {
  // The permissions namespace is outside the typed resources: its keys are permission codes.
  const name: unknown = i18n.getResource(i18n.language, 'permissions', code);
  return typeof name === 'string' ? name : permissionDefinition(code).name;
}

export default i18n;
