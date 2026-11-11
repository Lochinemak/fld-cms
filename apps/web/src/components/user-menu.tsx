import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  CircleUser,
  FileSpreadsheet,
  KeyRound,
  Languages,
  Laptop,
  LogOut,
  ShieldCheck,
  UserRoundPen,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChangePasswordDialog } from '@/components/change-password-form';
import { MfaDialog } from '@/components/mfa-dialog';
import { ProfileDialog } from '@/components/profile-dialog';
import { SignInSessionsDialog } from '@/components/sign-in-sessions-dialog';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { changeLanguage, LANGUAGES, type Language } from '@/i18n';
import { meQuery, signOutAndReload, useMe } from '@/lib/auth';

export function UserMenu() {
  const { user } = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editingProfile, setEditingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [viewingSessions, setViewingSessions] = useState(false);
  const [settingUpMfa, setSettingUpMfa] = useState(false);
  const { t, i18n } = useTranslation('layout');
  const languages = Object.entries(LANGUAGES) as [Language, { name: string }][];

  function editProfile() {
    // Asked again: the email changes in another tab, the one the mailed link opens.
    void queryClient.invalidateQueries({ queryKey: meQuery.queryKey });
    setEditingProfile(true);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <CircleUser />
          <span className="max-w-40 truncate">{user.displayName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <div className="truncate text-sm font-medium text-foreground">{user.displayName}</div>
              <div className="truncate text-xs font-normal">{user.username}</div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={editProfile}>
            <UserRoundPen />
            {t('profile')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setChangingPassword(true)}>
            <KeyRound />
            {t('changePassword')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setSettingUpMfa(true)}>
            <ShieldCheck />
            {t('mfa')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setViewingSessions(true)}>
            <Laptop />
            {t('signInSessions')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void navigate({ to: '/spreadsheets' })}>
            <FileSpreadsheet />
            {t('spreadsheets')}
          </DropdownMenuItem>
          {/* Offered once the interface comes in more than one language. */}
          {languages.length > 1 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Languages />
                {t('language')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={i18n.language}
                  onValueChange={(value) => void changeLanguage(value as Language)}
                >
                  {languages.map(([tag, language]) => (
                    <DropdownMenuRadioItem key={tag} value={tag}>
                      {language.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuItem onClick={() => void signOutAndReload()}>
            <LogOut />
            {t('signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {editingProfile && <ProfileDialog onClosed={() => setEditingProfile(false)} />}
      {changingPassword && <ChangePasswordDialog onClosed={() => setChangingPassword(false)} />}
      {viewingSessions && <SignInSessionsDialog onClosed={() => setViewingSessions(false)} />}
      {settingUpMfa && <MfaDialog onClosed={() => setSettingUpMfa(false)} />}
    </>
  );
}
